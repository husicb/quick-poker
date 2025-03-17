# Quick Poker Project Guide

## Project Overview
Quick Poker is a web application that allows users to quickly create and join poker games with friends using a simple game ID system (similar to Kahoot). The application uses a React frontend and Node.js backend with Socket.IO for real-time communication.

## System Requirements
- Node.js (v14+)
- npm (v6+)
- Web browser with JavaScript enabled
- Currently running on a MacBook Pro M3

## Project Structure
```
quick-poker/
├── client/                 # React frontend
│   ├── public/
│   │   ├── index.html
│   │   └── manifest.json
│   ├── src/
│   │   ├── App.js          # Main application component
│   │   ├── App.css         # Application styles
│   │   ├── index.js        # Entry point
│   │   └── index.css       # Global styles
│   └── package.json        # Frontend dependencies
│
└── server/                 # Node.js backend
    ├── server.js           # Server code
    └── package.json        # Backend dependencies
```

## Setup Instructions

### Server Setup
1. Navigate to the server directory:
   ```bash
   cd quick-poker/server
   ```

2. Install dependencies:
   ```bash
   npm install express socket.io uuid cors
   ```

3. Configure CORS in server.js:
   ```javascript
   app.use(cors({
     origin: "http://localhost:3000",
     methods: ["GET", "POST"],
     credentials: true
   }));
   
   const io = socketIo(server, {
     cors: {
       origin: "http://localhost:3000",
       methods: ["GET", "POST"],
       credentials: true
     }
   });
   ```

4. Start the server:
   ```bash
   node server.js
   ```
   The server runs on port 5001 by default.

### Client Setup
1. Navigate to the client directory:
   ```bash
   cd quick-poker/client
   ```

2. Install dependencies:
   ```bash
   npm install react react-dom react-scripts socket.io-client
   ```

3. Configure API_URL in App.js:
   ```javascript
   const API_URL = 'http://localhost:5001';
   ```

4. Start the development server:
   ```bash
   npm start
   ```
   The client runs on http://localhost:3000 by default.

## Key Features
- Create a poker game with a unique 6-character game ID
- Join existing games using the game ID
- Real-time gameplay with Socket.IO
- Texas Hold'em poker rules
- Chip tracking and betting system
- Automatic dealer rotation

## Poker Gameplay
1. Create or join a game
2. Wait for all players to click "I'm Ready"
3. The game automatically assigns blinds and deals cards
4. Players take turns to check, call, raise, or fold
5. The game progresses through the betting rounds, flop, turn, and river
6. The pot is awarded to the winner

## Development Notes

### Common Issues
1. **CORS errors**: Ensure CORS is properly configured in server.js to allow connections from the client origin.
2. **Port conflicts**: If you get an EADDRINUSE error, change the port in the server.js file:
   ```javascript
   const PORT = process.env.PORT || 5001;
   ```
   Remember to update the client's API_URL to match.

3. **Socket connection issues**: Check that Socket.IO versions are compatible between client and server.

### Deployment
For deployment, you'll need:
1. A hosting service for the Node.js backend (e.g., Render)
2. A static site hosting service for the React frontend (e.g., Netlify)
3. Update the CORS and API_URL settings to use the deployed URLs instead of localhost

## Future Enhancements
1. Implement poker hand evaluation for proper showdowns
2. Add user authentication
3. Save game history
4. Add animations and sound effects
5. Support for different poker variants
6. Mobile-responsive design improvements

## GitHub Repository
The project is stored in a Git repository with the following structure:
- Main branch contains the stable version
- Development is done in feature branches
- Changes are pushed to GitHub and can be automatically deployed

## Key Files

### server.js
The main server file that handles:
- Game creation and management
- Player connections and actions
- Card dealing and game flow
- Real-time communication with clients

### App.js
The main React component that includes:
- Game creation and joining functionality
- Game state display and UI
- Player action handling
- Connection to the backend via Socket.IO

### App.css
Contains all the styling for the poker interface:
- Card designs
- Poker table layout
- UI elements and buttons
- Player positions and chips
