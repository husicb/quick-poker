# Quick Poker

A real-time multiplayer poker game that allows users to quickly create and join poker games with friends using a simple game ID system.

## Features

- Create or join poker games with a unique 6-character game ID
- Support for 2-8 players
- Real-time gameplay with Socket.IO
- Texas Hold'em poker rules
- Chip tracking and betting system
- Automatic dealer rotation

## Tech Stack

- **Frontend**: React, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO
- **No database** - all game state is stored in memory

## Getting Started

### Prerequisites

- Node.js (v14+)
- npm (v6+)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/quick-poker.git
   cd quick-poker
   ```

2. Install backend dependencies
   ```
   cd server
   npm install
   ```

3. Install frontend dependencies
   ```
   cd ../client
   npm install
   ```

### Running the Application

1. Start the backend server
   ```
   cd server
   node server.js
   ```

2. Start the frontend development server
   ```
   cd client
   npm start
   ```

3. Open your browser and navigate to `http://localhost:3000`

## How to Play

1. Create a new game or join an existing one with a game ID
2. Share the game ID with friends so they can join
3. Click "I'm Ready" when everyone has joined
4. Play Texas Hold'em!

## Disclaimer

This software is provided for educational and entertainment purposes only. The author is not responsible for any misuse, including real-money gambling. Users should comply with all applicable laws.

## License

This project is open source and available under the [MIT License](LICENSE). 
