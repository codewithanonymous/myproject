const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
require('dotenv').config();

// Import our custom modules
const db = require('./db');
const { initSocket, emitNewSnap } = require('./socket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- Socket.IO Initialization ---
initSocket(server);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- File Upload Setup ---
const uploadDir = path.join(__dirname, 'public', 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const fileExt = path.extname(file.originalname).toLowerCase();
        const newFilename = `${uuidv4()}${fileExt}`;
        cb(null, newFilename);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, and GIF are allowed.'));
        }
    }
});

// --- Routes ---

// Serve the index page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload a new snap
app.post('/api/snaps', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        const { username = 'anonymous', caption = '', hashtags = '', location = '' } = req.body;
        
        // Add to database - this now handles user creation and returns proper image URL
        const snap = db.addSnap(
            username,
            req.file.filename, // Just store filename, not full path
            caption,
            hashtags,
            location
        );

        // The snap object already has the correct imageUrl from db.addSnap
        const response = {
            success: true,
            snap: snap
        };

        // Notify connected clients about the new snap
        if (emitNewSnap) {
            emitNewSnap(snap);
        }

        res.status(201).json(response);
    } catch (error) {
        console.error('Error uploading snap:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to upload snap',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get all snaps
app.get('/api/snaps', (req, res) => {
    try {
        const snaps = db.getAllSnaps();
        console.log('Fetched snaps:', snaps);
        res.json({ success: true, snaps });
    } catch (error) {
        console.error('Error fetching snaps:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch snaps',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get a single snap by ID
app.get('/api/snaps/:id', (req, res) => {
    try {
        const snap = db.getSnapById(req.params.id);
        if (!snap) {
            return res.status(404).json({ success: false, message: 'Snap not found' });
        }
        
        res.json({
            success: true,
            snap: {
                ...snap,
                imageUrl: `/uploads/${snap.image_path}`
            }
        });
    } catch (error) {
        console.error(`Error fetching snap ${req.params.id}:`, error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch snap',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));


// Get all snaps (for backwards compatibility)
app.get('/api/snaps', authenticateToken, async (req, res) => {
    try {
        console.log('Fetching all snaps...');
        console.log('Current working directory:', process.cwd());
        
        const snaps = db.prepare(`
            SELECT 
                s.id, 
                s.image_path as imageUrl,
                s.caption,
                s.hashtags,
                s.location,
                s.created_at as createdAt,
                u.username
            FROM snaps s
            JOIN users u ON s.posted_by = u.id
            ORDER BY s.created_at DESC
        `).all();
        
        console.log('Raw database image paths:', snaps.map(s => s.imageUrl));
        
        // Mark snaps as viewed by the current user
        const markAsViewed = db.prepare(`
            INSERT OR IGNORE INTO views (snap_id, viewed_by)
            VALUES (?, ?)
        `);
        
        const markAllAsViewed = db.transaction((snaps, userId) => {
            for (const snap of snaps) {
                markAsViewed.run(snap.id, userId);
            }
        });
        
        markAllAsViewed(snaps, req.user.id);
        
        res.json({
            success: true,
            snaps: snaps.map(snap => ({
                ...snap,
                viewed: true
            }))
        });
        
    } catch (error) {
        console.error('Error fetching snaps:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch snaps' 
        });
    }
});

// Get feed with pagination
app.get('/api/feed', (req, res) => {
    try {
        // 1. Validate and parse query parameters
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
        const offset = (page - 1) * limit;

        console.log(`[/api/feed] Fetching feed - Page: ${page}, Limit: ${limit}`);

        // 2. Get paginated snaps
        const snaps = db.getAllSnaps();
        const paginatedSnaps = snaps.slice(offset, offset + limit);
        const totalCount = snaps.length;

        // 3. Prepare and send response
        const response = {
            success: true,
            snaps: paginatedSnaps,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        };

        console.log(`[/api/feed] Sending ${paginatedSnaps.length} snaps`);
        res.json(response);

    } catch (error) {
        console.error('[/api/feed] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch feed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }    
});

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Debug endpoint for testing image paths (no auth required)
app.get('/api/debug/image-paths', (req, res) => {
    // Use actual filenames from the uploads directory
    const testPaths = [
        '05074f23-82ef-4fce-8247-aa604ab300c9.jpg',
        '/05074f23-82ef-4fce-8247-aa604ab300c9.jpg',
        'uploads/05074f23-82ef-4fce-8247-aa604ab300c9.jpg',
        '/uploads/05074f23-82ef-4fce-8247-aa604ab300c9.jpg',
        '//uploads//05074f23-82ef-4fce-8247-aa604ab300c9.jpg'
    ];
    
    const results = testPaths.map(original => {
        // Try to normalize the path
        let normalized = original.replace(/^\/+|\/+$/g, '');
        if (normalized.startsWith('uploads/')) {
            normalized = normalized.substring(8);
        }
        normalized = '/uploads/' + normalized.replace(/^\/+/, '');
        
        return {
            original,
            normalized,
            url: new URL(normalized, 'http://localhost:3000').href
        };
    });
    
    res.json({
        workingDirectory: process.cwd(),
        __dirname,
        testPaths: results
    });
});

// Serve the feed page (now client-side JS handles auth redirect)
app.get('/feed', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'feed.html'));
});

// Serve the upload page
app.get('/upload', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// API route for user registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const userId = db.createUser(username, passwordHash);
        res.status(201).json({ success: true, message: 'User registered successfully.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// API route for user login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.findUserByUsername(username);
    if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid username or password.' });
    }
    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
        return res.status(400).json({ success: false, message: 'Invalid username or password.' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token, user: { id: user.id, username: user.username } });
});

// API route to get feed snaps (protected)
app.get('/api/feed', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const newSnaps = db.getUnviewedSnaps(userId);
    const recentlyViewedSnaps = db.getRecentlyViewedSnaps(userId);
    const dailySnapsRemaining = 3 - db.getDailySnapCount(userId);

    res.json({
        user: { username: req.user.username },
        newSnaps: newSnaps,
        recentlyViewedSnaps: recentlyViewedSnaps,
        dailySnapsRemaining: dailySnapsRemaining > 0 ? dailySnapsRemaining : 0
    });
});

// API route to upload a new snap (protected)
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    const { caption, hashtags, location } = req.body;
    const userId = req.user.id;

    // Check if user has reached daily snap limit (3 snaps)
    if (db.getDailySnapCount(userId) >= 3) {
        return res.status(403).json({ success: false, message: 'You have reached your daily snap limit of 3.' });
    }

    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }

    try {
        const imagePath = path.join('uploads', req.file.filename);
        const snapId = db.addSnap(userId, imagePath, caption, hashtags, location);
        
        // After a successful upload, emit a real-time event to all clients
        const snapData = {
            id: snapId,
            postedBy: userId,
            imagePath: imagePath,
            caption: caption,
            hashtags: hashtags,
            location: location,
            createdAt: new Date().toISOString()
        };
        emitNewSnap(snapData);
        
        res.json({ success: true, message: 'Snap uploaded successfully!', snapId });
    } catch (error) {
        console.error('Snap upload failed:', error);
        res.status(500).json({ success: false, message: 'An error occurred during upload.' });
    }
});

// API route to mark a snap as viewed (protected)
app.post('/api/snap/view', authenticateToken, (req, res) => {
    const { snapId } = req.body;
    const userId = req.user.id;
    try {
        db.markSnapAsViewed(snapId, userId);
        res.json({ success: true, message: 'Snap marked as viewed.' });
    } catch (error) {
        console.error('Error marking snap as viewed:', error);
        res.status(500).json({ success: false, message: 'Failed to mark snap as viewed.' });
    }
});

// Admin API to get all snaps
app.get('/api/admin/snaps', authenticateToken, (req, res) => {
    if (req.user.username !== 'manager') {
        return res.status(403).json({ success: false, message: 'Access Denied.' });
    }
    const allSnaps = db.getAllSnaps();
    res.json({ success: true, snaps: allSnaps });
});

// --- Start the server ---
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
