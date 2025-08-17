# KITSFLICK - Segregated Frontend & Backend

This project has been restructured to separate frontend and backend components while maintaining all existing functionalities.

## Project Structure

```
snap-clone/
├── backend/                 # Backend server and API
│   ├── server-pg.js        # Main PostgreSQL server
│   ├── server.js           # SQLite server (legacy)
│   ├── db-pg.js            # PostgreSQL database configuration
│   ├── socket.js           # Socket.IO configuration
│   ├── migrations/         # Database migrations
│   ├── package.json        # Backend dependencies
│   └── .env               # Environment variables
├── frontend/               # Frontend static files
│   ├── index.html         # Main page
│   ├── feed.html          # Feed page
│   ├── upload.html        # Upload page
│   ├── admin.html         # Admin page
│   ├── css/               # Stylesheets
│   ├── js/                # JavaScript files
│   ├── uploads/           # User uploaded images
│   └── package.json       # Frontend dependencies
└── README.md              # This file
```

## Running the Application

### Backend (API Server)
```bash
cd backend
npm install
npm start
```
The backend server runs on `http://localhost:3000`

### Frontend (Optional - for development)
```bash
cd frontend
npm install
npm start
```
The frontend dev server runs on `http://localhost:8080`

**Note:** The backend server automatically serves the frontend files, so you can access the full application at `http://localhost:3000` without running the frontend server separately.

## Database Setup

The application uses PostgreSQL. Make sure you have:
- PostgreSQL installed and running
- Database credentials configured in `backend/.env`
- Run migrations: `cd backend && npm run migrate`

## Features

- User authentication (signup/login)
- Image upload and sharing
- Real-time feed updates via Socket.IO
- Admin panel for user management
- Responsive design

## API Endpoints

All API endpoints are served from the backend on port 3000:
- `POST /api/register` - User registration
- `POST /api/login` - User login
- `POST /api/upload` - Image upload
- `GET /api/snaps` - Get all snaps
- `GET /api/users` - Get all users (admin)
- And more...
