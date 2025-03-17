// App.js
import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// Card components
const Card = ({ card }) => {
  if (!card) return <div className="card card-back"></div>;
  
  const { suit, value } = card;
  const color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
  
  return (
    <div className={`card ${color}`}>
      <div className="card-value">{value}</div>
      <div className="card-suit">{getSuitSymbol(suit)}</div>
    </div>
  );
};

// Winner display component
const WinnerDisplay = ({ winner, players, myId, onPlayAgain }) => {
  if (!winner) return null;
  
  const amIReady = players[myId]?.isReady;
  const playersArray = Object.values(players);
  const readyCount = playersArray.filter(p => p.isReady).length;
  const totalPlayers = playersArray.length;
  
  return (
    <div className="winner-overlay">
      <div className="winner-container">
        <h2 className="winner-title">Winner!</h2>
        <div className="winner-details">
          <p><strong>{winner.name}</strong> wins the hand</p>
          <p className="winner-amount">${winner.amount}</p>
          <p className="winner-reason">{winner.reason}</p>
        </div>
        
        <div className="players-ready-status">
          <p className="ready-counter">{readyCount} of {totalPlayers} players ready</p>
          <div className="players-ready-list">
            {playersArray.map(player => (
              <div key={player.id} className="player-ready-item">
                <span>{player.name}</span>
                <span className={player.isReady ? 'ready' : 'not-ready'}>
                  {player.isReady ? '✓ Ready' : 'Not Ready'}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        {!amIReady ? (
          <button className="btn play-again-btn" onClick={onPlayAgain}>
            I'm Ready
          </button>
        ) : (
          <p className="waiting-message">Waiting for other players...</p>
        )}
      </div>
    </div>
  );
};

const getSuitSymbol = (suit) => {
  switch (suit) {
    case 'hearts': return '♥';
    case 'diamonds': return '♦';
    case 'clubs': return '♣';
    case 'spades': return '♠';
    default: return '';
  }
};

const API_URL = 'https://quick-poker.onrender.com';
let socket;

function App() {
  const [view, setView] = useState('home');
  const [gameId, setGameId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [betAmount, setBetAmount] = useState(0);
  
  // Initialize socket connection and load saved player name
  useEffect(() => {
    // Load saved player name if available
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
      setPlayerName(savedName);
    }
    
    // Check for stored game ID in sessionStorage
    const savedGameId = sessionStorage.getItem('gameId');
    if (savedGameId) {
      setGameId(savedGameId);
    }
    
    socket = io(API_URL);
    
    socket.on('error', (data) => {
      setError(data.message);
      
      // Clear error after 5 seconds
      setTimeout(() => setError(''), 5000);
    });
    
    socket.on('proceedToRegularJoin', () => {
      // If rejoin fails, try normal join
      if (playerName && gameId) {
        joinGame(gameId);
      }
    });
    
    socket.on('playerJoined', ({ game }) => {
      setGame(game);
      setView('game');
      
      // Save game ID for reconnection
      sessionStorage.setItem('gameId', game.id);
    });
    
    socket.on('gameUpdate', ({ game }) => {
      console.log(`Game update received. Phase: ${game.phase}, Turn: ${game.turn === socket.id ? 'My Turn' : 'Not My Turn'}`);
      if (game.turn) {
        const currentPlayerName = game.players[game.turn]?.name || 'Unknown';
        console.log(`Current player's turn: ${currentPlayerName}`);
      }
      setGame(game);
    });
    
    socket.on('playerLeft', ({ game }) => {
      setGame(game);
    });
    
    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Save player name when it changes
  useEffect(() => {
    if (playerName) {
      localStorage.setItem('playerName', playerName);
    }
  }, [playerName]);
  
  // Create a new game
  const createGame = async () => {
    try {
      const response = await fetch(`${API_URL}/api/games`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      setGameId(data.gameId);
      joinGame(data.gameId);
    } catch (err) {
      setError('Failed to create game');
    }
  };
  
  // Join an existing game
  const joinGame = (id = gameId) => {
    if (!id) {
      setError('Please enter a Game ID');
      return;
    }
    
    if (!playerName) {
      setError('Please enter your name');
      return;
    }
    
    // Try to rejoin first in case we're reconnecting
    const savedGameId = sessionStorage.getItem('gameId');
    if (savedGameId === id) {
      socket.emit('rejoinGame', { gameId: id, playerName });
    } else {
      socket.emit('joinGame', { gameId: id, playerName });
    }
  };
  
  // Set player as ready
  const setReady = () => {
    socket.emit('ready');
  };
  
  // Handle player actions
  const handleAction = (action, amount = 0) => {
    socket.emit('playerAction', { action, amount: parseInt(amount, 10) });
  };
  
  // Determine if it's the current player's turn
  const isMyTurn = () => {
    if (!game || !socket) {
      console.log("Can't determine turn: game or socket not available");
      return false;
    }
    
    const result = game.turn === socket.id;
    console.log(`Is my turn check: My ID=${socket.id}, Current Turn=${game.turn}, Result=${result}`);
    
    return result;
  };
  
  // Render functions for different views
  const renderHomeView = () => (
    <div className="home-container">
      <h1>Quick Poker</h1>
      
      <div className="form-group">
        <label>Your Name</label>
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Enter your name"
        />
      </div>
      
      <div className="buttons">
        <button onClick={createGame} className="btn primary">Create New Game</button>
        <div className="or-divider">or</div>
        <div className="form-group">
          <label>Join with Game ID</label>
          <div className="join-input">
            <input
              type="text"
              value={gameId}
              onChange={(e) => setGameId(e.target.value.toUpperCase())}
              placeholder="Enter Game ID"
              maxLength={6}
            />
            <button onClick={() => joinGame()} className="btn secondary">Join Game</button>
          </div>
        </div>
      </div>
      
      {error && <div className="error">{error}</div>}
    </div>
  );
  
  const renderWaitingRoom = () => (
    <div className="waiting-room">
      <h2>Game ID: {game.id} 
        <button 
          onClick={() => {
            navigator.clipboard.writeText(game.id);
            setError('Game ID copied to clipboard!');
            setTimeout(() => setError(''), 2000);
          }}
          className="copy-btn"
          title="Copy Game ID"
        >
          📋
        </button>
      </h2>
      <p>Share this ID with your friends to join!</p>
      
      <div className="players-list">
        <h3>Players</h3>
        {Object.values(game.players).map(player => (
          <div key={player.id} className="player-item">
            <span>{player.name}</span>
            <span>{player.isReady ? '✓ Ready' : 'Not Ready'}</span>
          </div>
        ))}
      </div>
      
      {!game.players[socket.id].isReady ? (
        <button onClick={setReady} className="btn primary">I'm Ready</button>
      ) : (
        <p>Waiting for other players to get ready...</p>
      )}
      
      {error && <div className="error">{error}</div>}
    </div>
  );
  
  const renderGameTable = () => {
    const me = game.players[socket.id];
    const isCurrentTurn = isMyTurn();
    const players = Object.values(game.players);
    
    return (
      <div className="game-table">
        <div className="game-info">
          <div>Game ID: {game.id}</div>
          <div>Phase: {game.phase}</div>
          <div>Pot: ${game.pot}</div>
          <div>Current Bet: ${game.currentBet}</div>
          <div>You: {me.name}</div>
          <div>Your Chips: ${me.chips}</div>
          <div>Players: {players.length}/8</div>
        </div>
        
        <div className="community-cards">
          {game.communityCards.map((card, index) => (
            <Card key={index} card={card} />
          ))}
        </div>
        
        <div className="players-area">
          {players.map((player, index) => {
            // Calculate position class - this ensures players are displayed in proper positions around the table
            // We always position the current player at the bottom (position 0)
            const myIndex = players.findIndex(p => p.id === socket.id);
            // Calculate relative position from current player's perspective
            const relativePosition = (index - myIndex + players.length) % players.length;
            
            // Map relative position to a position class
            return (
              <div 
                key={player.id} 
                className={`player-spot player-position-${relativePosition} ${player.id === game.turn ? 'active-player' : ''} ${player.folded ? 'folded' : ''} ${player.id === socket.id ? 'current-player' : ''}`}
              >
                <div className="player-name">{player.name} {player.id === socket.id && '(You)'}</div>
                <div className="player-chips">${player.chips}</div>
                
                {player.bet > 0 && (
                  <div className="player-bet">${player.bet}</div>
                )}
                
                <div className="player-cards">
                  {player.cards.map((card, index) => (
                    <Card key={index} card={card} />
                  ))}
                </div>
                
                {player.id === game.dealerId && (
                  <div className="dealer-button">D</div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="action-buttons">
          {game.phase === 'waiting' ? (
            <button onClick={setReady} className="btn primary">Play Next Hand</button>
          ) : (
            isCurrentTurn && !me.folded && (
              <>
                {game.currentBet === me.bet && (
                  <button 
                    onClick={() => handleAction('check')} 
                    className="btn action-btn check"
                  >
                    Check
                  </button>
                )}
                
                {game.currentBet > me.bet && (
                  <button 
                    onClick={() => handleAction('call')} 
                    className="btn action-btn call"
                  >
                    Call ${game.currentBet - me.bet}
                  </button>
                )}
                
                <div className="raise-container">
                  <input
                    type="number"
                    min={game.currentBet + 1}
                    max={me.chips + me.bet}
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                  />
                  <button 
                    onClick={() => handleAction('raise', betAmount)} 
                    className="btn action-btn raise"
                    disabled={betAmount <= game.currentBet}
                  >
                    Raise
                  </button>
                </div>
                
                <button 
                  onClick={() => handleAction('fold')} 
                  className="btn action-btn fold"
                >
                  Fold
                </button>
              </>
            )
          )}
        </div>
        
        {error && <div className="error">{error}</div>}
        
        {/* Show winner overlay when in showdown phase */}
        {game.phase === 'showdown' && game.lastWinner && (
          <WinnerDisplay 
            winner={game.lastWinner} 
            players={game.players}
            myId={socket.id}
            onPlayAgain={setReady}
          />
        )}
      </div>
    );
  };
  
  // Main render function
  return (
    <div className="app">
      {view === 'home' && renderHomeView()}
      {view === 'game' && game && (
        game.phase === 'waiting' && !game.players[socket.id]?.isReady
          ? renderWaitingRoom()
          : renderGameTable()
      )}
    </div>
  );
}

export default App;