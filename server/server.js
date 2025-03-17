// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store active games
const games = {};
// Store disconnected players to allow reconnection
const disconnectedPlayers = {};

// Card deck utility
const createDeck = () => {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  return shuffle(deck);
};

// Shuffle array (Fisher-Yates algorithm)
const shuffle = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Create a new game
app.post('/api/games', (req, res) => {
  const gameId = uuidv4().substring(0, 6).toUpperCase(); // Short, easy to share code
  
  games[gameId] = {
    id: gameId,
    players: {},
    deck: createDeck(),
    communityCards: [],
    currentBet: 0,
    pot: 0,
    turn: null,
    phase: 'waiting', // waiting, dealing, betting, flop, turn, river, showdown
    createdAt: Date.now()
  };
  
  res.json({ gameId });
});

// Socket connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Store active game timers
  const gameActivityTimers = {};
  
  // Check if player was previously disconnected and trying to rejoin
  socket.on('rejoinGame', ({ gameId, playerName }) => {
    gameId = gameId.toUpperCase();
    
    if (!games[gameId]) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    
    // Check if player name matches a disconnected player
    const disconnectedPlayerIds = Object.keys(disconnectedPlayers);
    const matchingPlayer = disconnectedPlayerIds.find(id => 
      disconnectedPlayers[id].gameId === gameId && 
      disconnectedPlayers[id].name === playerName
    );
    
    if (matchingPlayer) {
      const game = games[gameId];
      
      // Transfer player data from disconnected player to current socket
      game.players[socket.id] = { 
        ...disconnectedPlayers[matchingPlayer],
        id: socket.id 
      };
      
      // Remove from disconnected players
      delete disconnectedPlayers[matchingPlayer];
      
      // Join socket room
      socket.join(gameId);
      socket.gameId = gameId;
      
      // Notify everyone in the room with individualized game states
      Object.keys(game.players).forEach(playerId => {
        io.to(playerId).emit('gameUpdate', {
          game: sanitizeGame(game, playerId)
        });
      });
      
      // Notify the rejoining player
      socket.emit('playerJoined', {
        game: sanitizeGame(game, socket.id)
      });
      
      console.log(`Player ${playerName} rejoined game ${gameId}`);
    } else {
      // Just join normally
      socket.emit('error', { message: 'No previous session found. Joining as new player.' });
      socket.emit('proceedToRegularJoin');
    }
  });
  
  // Join a game
  socket.on('joinGame', ({ gameId, playerName }) => {
    // Convert gameId to uppercase for case insensitivity
    gameId = gameId.toUpperCase();
    
    if (!games[gameId]) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    
    const game = games[gameId];
    
    // Check if game is full (max 8 players for a poker table)
    if (Object.keys(game.players).length >= 8) {
      socket.emit('error', { message: 'Game is full (maximum 8 players)' });
      return;
    }
    
    // Add player to game
    game.players[socket.id] = {
      id: socket.id,
      name: playerName,
      chips: 1000, // Starting chips
      cards: [],
      bet: 0,
      folded: false,
      isReady: false
    };
    
    // Join socket room
    socket.join(gameId);
    
    // If this is the first player, make them the dealer
    if (Object.keys(game.players).length === 1) {
      game.dealerId = socket.id;
    }
    
    // Notify everyone in the room
    Object.keys(game.players).forEach(playerId => {
      io.to(playerId).emit('playerJoined', {
        game: sanitizeGame(game, playerId)
      });
    });
    
    // Store gameId in socket for future reference
    socket.gameId = gameId;
  });
  
  // Player is ready
  socket.on('ready', () => {
    if (!socket.gameId || !games[socket.gameId]) return;
    
    const game = games[socket.gameId];
    game.players[socket.id].isReady = true;
    
    console.log(`Player ${game.players[socket.id].name} is ready`);
    
    // Check if all players are ready (at least 2 players needed)
    const players = Object.values(game.players);
    const playersReady = players.filter(p => p.isReady).length;
    
    // If we're in showdown phase and players ready up, we need to reset additional state
    if (game.phase === 'showdown' && playersReady >= 2 && playersReady === players.length) {
      console.log(`All players ready after showdown - starting new hand`);
      
      // Reset community cards and player cards/bets before starting new game
      game.communityCards = [];
      
      // Reset player states that weren't reset at end of hand
      Object.values(game.players).forEach(player => {
        player.folded = false;
        player.cards = [];
        player.bet = 0;
      });
      
      // Rotate dealer position
      const playerIds = Object.keys(game.players);
      const dealerIndex = playerIds.indexOf(game.dealerId);
      game.dealerId = playerIds[(dealerIndex + 1) % playerIds.length];
      
      // Set phase to waiting briefly before starting the new game
      game.phase = 'waiting';
      
      // Send update right before starting the new game
      Object.keys(game.players).forEach(playerId => {
        io.to(playerId).emit('gameUpdate', {
          game: sanitizeGame(game, playerId)
        });
      });
      
      // Start the new game
      startGame(game);
      return;
    }
    
    // Normal ready-up logic for waiting phase
    if (game.phase === 'waiting' && playersReady >= 2 && playersReady === players.length) {
      startGame(game);
    }
    
    // Send individualized game state to each player
    Object.keys(game.players).forEach(playerId => {
      io.to(playerId).emit('gameUpdate', {
        game: sanitizeGame(game, playerId)
      });
    });
  });
  
  // Player actions: check, call, raise, fold
  socket.on('playerAction', ({ action, amount }) => {
    if (!socket.gameId || !games[socket.gameId]) {
      console.log(`Player ${socket.id} tried to act but game not found`);
      return;
    }
    
    const game = games[socket.gameId];
    const player = game.players[socket.id];
    
    if (!player) {
      console.log(`Player ${socket.id} not found in game ${socket.gameId}`);
      socket.emit('error', { message: 'Player not found in game' });
      return;
    }
    
    console.log(`Action received from ${player.name} (${socket.id}): ${action}${amount ? ' $' + amount : ''}`);
    console.log(`Current turn is: ${game.players[game.turn]?.name} (${game.turn})`);
    
    // Only allow actions from the current player
    if (game.turn !== socket.id) {
      console.log(`Rejected action: not ${player.name}'s turn`);
      socket.emit('error', { message: 'Not your turn' });
      return;
    }
    
    // Mark this player as having acted in this round
    game.playersActedThisRound[socket.id] = true;
    
    switch (action) {
      case 'check':
        if (game.currentBet > player.bet) {
          socket.emit('error', { message: 'Cannot check, must call or fold' });
          return;
        }
        console.log(`${player.name} checks`);
        break;
        
      case 'call':
        // Match the current bet
        const callAmount = game.currentBet - player.bet;
        if (callAmount > player.chips) {
          // All-in
          game.pot += player.chips;
          player.bet += player.chips;
          player.chips = 0;
          console.log(`${player.name} calls all-in with $${player.chips}`);
        } else {
          game.pot += callAmount;
          player.bet = game.currentBet;
          player.chips -= callAmount;
          console.log(`${player.name} calls $${callAmount}`);
        }
        break;
        
      case 'raise':
        if (!amount || isNaN(amount)) {
          socket.emit('error', { message: 'Invalid bet amount' });
          return;
        }
        
        if (amount <= game.currentBet) {
          socket.emit('error', { message: 'Raise must be higher than current bet' });
          return;
        }
        
        if (amount > player.chips + player.bet) {
          socket.emit('error', { message: 'Not enough chips' });
          return;
        }
        
        // Enforce minimum raise (at least as much as the previous raise)
        const minRaise = game.currentBet * 2;
        if (amount < minRaise && amount < player.chips + player.bet) {
          socket.emit('error', { message: `Minimum raise is ${minRaise}` });
          return;
        }
        
        const raiseAmount = amount - player.bet;
        game.pot += raiseAmount;
        player.chips -= raiseAmount;
        player.bet = amount;
        game.currentBet = amount;
        
        // When a player raises, we need to reset who has acted, except for the raiser
        const raiserId = socket.id;
        game.playersActedThisRound = {};
        game.playersActedThisRound[raiserId] = true;
        
        console.log(`${player.name} raises to $${amount} - resetting who has acted`);
        break;
        
      case 'fold':
        player.folded = true;
        console.log(`${player.name} folds`);
        break;
        
      default:
        socket.emit('error', { message: 'Invalid action' });
        return;
    }
    
    // Move to next player or next phase
    nextPlayerOrPhase(game);
    
    // Update all clients with their individualized game state
    Object.keys(game.players).forEach(playerId => {
      io.to(playerId).emit('gameUpdate', {
        game: sanitizeGame(game, playerId)
      });
    });
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (socket.gameId && games[socket.gameId]) {
      const game = games[socket.gameId];
      
      // Store player data for possible reconnection
      if (game.players[socket.id]) {
        disconnectedPlayers[socket.id] = {
          ...game.players[socket.id],
          gameId: socket.gameId,
          disconnectedAt: Date.now()
        };
        
        // Set a timeout to remove the player data if they don't reconnect
        setTimeout(() => {
          if (disconnectedPlayers[socket.id]) {
            delete disconnectedPlayers[socket.id];
          }
        }, 10 * 60 * 1000); // 10 minutes
      }
      
      // Remove player from game
      delete game.players[socket.id];
      
      // If no players left, remove the game after a delay
      if (Object.keys(game.players).length === 0) {
        // Set a timer to delete the game if no one joins back in 5 minutes
        gameActivityTimers[socket.gameId] = setTimeout(() => {
          console.log(`Game ${socket.gameId} deleted due to inactivity`);
          delete games[socket.gameId];
          delete gameActivityTimers[socket.gameId];
        }, 5 * 60 * 1000);
      } else {
        // If the dealer left, assign a new dealer
        if (game.dealerId === socket.id) {
          game.dealerId = Object.keys(game.players)[0];
        }
        
        // If it was the player's turn, move to next player
        if (game.turn === socket.id) {
          nextPlayerOrPhase(game);
        }
        
        // Check if game can continue (need at least 2 players)
        if (Object.keys(game.players).length < 2 && game.phase !== 'waiting') {
          // End the current hand and move to waiting phase
          game.phase = 'waiting';
          game.pot = 0;
          
          // Return bets to remaining players
          Object.values(game.players).forEach(player => {
            player.chips += player.bet;
            player.bet = 0;
            player.isReady = false;
            player.folded = false;
          });
          
          // Notify remaining players with individualized game states
          Object.keys(game.players).forEach(playerId => {
            io.to(playerId).emit('gameUpdate', {
              game: sanitizeGame(game, playerId)
            });
          });
          
          // Also send an error message about the game ending
          io.to(socket.gameId).emit('error', {
            message: 'Not enough players to continue. Waiting for more players to join.'
          });
          
          return;
        }
        
        // Notify remaining players with individualized game states
        Object.keys(game.players).forEach(playerId => {
          io.to(playerId).emit('playerLeft', {
            playerId: socket.id,
            game: sanitizeGame(game, playerId)
          });
        });
      }
    }
  });
});

// Start the game
function startGame(game) {
  console.log("Starting new game with players:", Object.values(game.players).map(p => p.name).join(", "));
  
  game.phase = 'dealing';
  game.deck = createDeck();
  game.communityCards = [];
  game.pot = 0;
  game.currentBet = 20; // Small blind + big blind
  game.playersActedThisRound = {}; // Track which players have acted this round
  
  // Reset player states
  Object.values(game.players).forEach(player => {
    player.cards = [];
    player.bet = 0;
    player.folded = false;
  });
  
  // Determine order of play based on dealer position
  const playerIds = Object.keys(game.players);
  console.log(`Player IDs in game: ${playerIds.join(", ")}`);
  console.log(`Current dealer: ${game.players[game.dealerId]?.name} (${game.dealerId})`);
  
  const dealerIndex = playerIds.indexOf(game.dealerId);
  
  // In a two-player game (heads-up), dealer is small blind and acts first pre-flop, but last post-flop
  const isHeadsUp = playerIds.length === 2;
  
  // Small blind and big blind positions
  const smallBlindIndex = (dealerIndex + 1) % playerIds.length;
  const bigBlindIndex = isHeadsUp ? (dealerIndex) : (dealerIndex + 2) % playerIds.length;
  
  // Assign blinds
  const smallBlindId = playerIds[smallBlindIndex];
  const bigBlindId = playerIds[bigBlindIndex];
  
  const smallBlind = game.players[smallBlindId];
  const bigBlind = game.players[bigBlindId];
  
  console.log(`Small blind: ${smallBlind.name} (${smallBlindId})`);
  console.log(`Big blind: ${bigBlind.name} (${bigBlindId})`);
  
  // Post blinds
  smallBlind.bet = 10;
  smallBlind.chips -= 10;
  game.pot += 10;
  
  bigBlind.bet = 20;
  bigBlind.chips -= 20;
  game.pot += 20;
  
  // Mark blinds as having acted
  game.playersActedThisRound[smallBlindId] = true;
  game.playersActedThisRound[bigBlindId] = true;
  
  // Deal cards
  Object.values(game.players).forEach(player => {
    player.cards = [game.deck.pop(), game.deck.pop()];
  });
  
  // First to act is after big blind
  let firstToActIndex;
  if (isHeadsUp) {
    // In heads-up, the dealer/small blind acts first pre-flop
    firstToActIndex = dealerIndex;
  } else {
    // With more players, first to act is after the big blind
    firstToActIndex = (bigBlindIndex + 1) % playerIds.length;
  }
  
  game.turn = playerIds[firstToActIndex];
  
  // Log who is acting first
  console.log(`Game started. First to act: ${game.players[game.turn].name} (${game.turn})`);
  
  game.phase = 'betting';
}

// Move to next player or next phase
function nextPlayerOrPhase(game) {
  const playerIds = Object.keys(game.players);
  const activePlayers = playerIds.filter(id => !game.players[id].folded);
  
  // If only one player remains, they win
  if (activePlayers.length === 1) {
    console.log(`Only one player remains: ${game.players[activePlayers[0]].name}. Ending hand.`);
    endHand(game, activePlayers[0]);
    return;
  }
  
  // Get current player's name for logging
  const currentPlayerName = game.players[game.turn]?.name || 'Unknown';
  
  // Determine if betting round is complete
  const nonFoldedPlayers = playerIds.filter(id => !game.players[id].folded);
  
  // Check if all active players have acted this round and everyone has either:
  // 1. Matched the current bet
  // 2. Gone all-in
  // 3. Folded (already filtered out)
  const allPlayersActed = nonFoldedPlayers.every(id => 
    // Player has acted this round
    game.playersActedThisRound[id] && 
    // And they've either matched the bet or are all-in
    (game.players[id].bet === game.currentBet || game.players[id].chips === 0)
  );
  
  console.log(`Checking if betting round complete: ${allPlayersActed ? 'Yes' : 'No'}`);
  console.log(`Active players: ${nonFoldedPlayers.length}, Players who acted: ${Object.keys(game.playersActedThisRound).length}`);
  
  if (allPlayersActed) {
    // Move to next phase
    const prevPhase = game.phase;
    
    // Store who acted last in the previous round for heads-up games
    const lastActorId = game.turn;
    
    switch (game.phase) {
      case 'betting':
        // Deal flop
        game.communityCards = [game.deck.pop(), game.deck.pop(), game.deck.pop()];
        game.phase = 'flop';
        resetBets(game);
        console.log(`Moving from ${prevPhase} to ${game.phase}. Dealt flop.`);
        break;
        
      case 'flop':
        // Deal turn
        game.communityCards.push(game.deck.pop());
        game.phase = 'turn';
        resetBets(game);
        console.log(`Moving from ${prevPhase} to ${game.phase}. Dealt turn card.`);
        break;
        
      case 'turn':
        // Deal river
        game.communityCards.push(game.deck.pop());
        game.phase = 'river';
        resetBets(game);
        console.log(`Moving from ${prevPhase} to ${game.phase}. Dealt river card.`);
        break;
        
      case 'river':
        // Showdown
        console.log(`Moving from ${prevPhase} to showdown. Ending hand.`);
        endHand(game);
        return;
    }
    
    // Find next player to act post-flop
    const dealerIndex = playerIds.indexOf(game.dealerId);
    
    // Handle special case for 2 players
    if (playerIds.length === 2) {
      // In heads-up (2 player) poker, the dealer acts first post-flop
      const nonDealerIndex = (dealerIndex + 1) % playerIds.length;
      const nonDealerId = playerIds[nonDealerIndex];
      
      // If the dealer was the last to act in the previous round,
      // the non-dealer should start the new round
      if (lastActorId === game.dealerId) {
        game.turn = nonDealerId;
        console.log(`Two player game: dealer was last to act, non-dealer ${game.players[nonDealerId].name} starts new round`);
      } else {
        game.turn = game.dealerId;
        console.log(`Two player game: dealer ${game.players[game.dealerId].name} acts first post-flop`);
      }
    } else {
      // With more than 2 players, first to act is the first active player after the dealer
      // We need to start with the small blind (which is right after the dealer)
      let nextIndex = (dealerIndex + 1) % playerIds.length;
      
      // Find the first non-folded player starting from the small blind position
      let safetyCounter = 0;
      while (safetyCounter < playerIds.length) {
        if (!game.players[playerIds[nextIndex]].folded) {
          break;
        }
        nextIndex = (nextIndex + 1) % playerIds.length;
        safetyCounter++;
      }
      
      game.turn = playerIds[nextIndex];
      console.log(`3+ player game: ${game.players[game.turn].name} (${game.turn}) starts post-flop betting`);
    }
    
    // Log the turn change
    console.log(`Turn moved from ${currentPlayerName} to ${game.players[game.turn].name} (${game.turn}) at start of new phase`);
  } else {
    // Move to next player
    const currentIndex = playerIds.indexOf(game.turn);
    let nextIndex = (currentIndex + 1) % playerIds.length;
    
    // Skip folded players or all-in players who can't act
    let safetyCounter = 0;
    while (safetyCounter < playerIds.length) {
      const playerId = playerIds[nextIndex];
      const player = game.players[playerId];
      
      if (!player.folded && !(player.chips === 0 && player.bet >= game.currentBet)) {
        // Found a valid player who can act
        break;
      }
      
      nextIndex = (nextIndex + 1) % playerIds.length;
      safetyCounter++;
    }
    
    game.turn = playerIds[nextIndex];
    
    // Log the turn change
    console.log(`Turn moved from ${currentPlayerName} to ${game.players[game.turn].name} (${game.turn})`);
  }
  
  // Add safety check in case we couldn't find a valid next player
  if (!playerIds.includes(game.turn) || !game.players[game.turn]) {
    console.log('Warning: Could not find valid next player. Using first active player.');
    game.turn = activePlayers[0];
  }
}

// Reset bets for a new betting round
function resetBets(game) {
  game.currentBet = 0;
  Object.values(game.players).forEach(player => {
    player.bet = 0;
  });
  // Reset the players who have acted for the new betting round
  game.playersActedThisRound = {};
}

// End the current hand
function endHand(game, winnerId = null) {
  let winnerInfo = {
    id: null,
    name: '',
    amount: game.pot,
    reason: ''
  };

  console.log('------ END OF HAND ------');
  
  if (winnerId) {
    // Single winner (everyone else folded)
    game.players[winnerId].chips += game.pot;
    winnerInfo.id = winnerId;
    winnerInfo.name = game.players[winnerId].name;
    winnerInfo.reason = 'All other players folded';
    console.log(`Winner: ${winnerInfo.name} wins $${game.pot} - All other players folded`);
  } else {
    // Simple showdown logic - last aggressor or random player if bets are equal
    // This is a placeholder for proper poker hand evaluation
    const activePlayers = Object.keys(game.players).filter(id => !game.players[id].folded);
    
    if (activePlayers.length === 1) {
      // Only one active player remains
      const winningPlayerId = activePlayers[0];
      game.players[winningPlayerId].chips += game.pot;
      
      winnerInfo.id = winningPlayerId;
      winnerInfo.name = game.players[winningPlayerId].name;
      winnerInfo.reason = 'Last player remaining';
      console.log(`Winner: ${winnerInfo.name} wins $${game.pot} - Last player remaining`);
    } else {
      // Find if there's a player with a higher bet (last aggressor)
      let highestBetPlayerId = null;
      let highestBet = 0;
      let allBetsEqual = true;
      let firstBet = game.players[activePlayers[0]].bet;
      
      // Check if all bets are equal or if there's a highest bettor
      for (const playerId of activePlayers) {
        const playerBet = game.players[playerId].bet;
        
        if (playerBet != firstBet) {
          allBetsEqual = false;
        }
        
        if (playerBet > highestBet) {
          highestBet = playerBet;
          highestBetPlayerId = playerId;
        }
      }
      
      let winningPlayerId;
      
      if (allBetsEqual) {
        // If all bets are equal, randomly select a winner for fairness
        // This simulates one player having a better hand than the other
        const randomIndex = Math.floor(Math.random() * activePlayers.length);
        winningPlayerId = activePlayers[randomIndex];
        console.log(`All bets are equal, randomly selecting a winner: ${game.players[winningPlayerId].name}`);
      } else {
        // Award pot to highest bettor
        winningPlayerId = highestBetPlayerId;
        console.log(`Highest bettor wins: ${game.players[winningPlayerId].name} with bet of $${highestBet}`);
      }
      
      // Award pot to the determined winner
      game.players[winningPlayerId].chips += game.pot;
      
      winnerInfo.id = winningPlayerId;
      winnerInfo.name = game.players[winningPlayerId].name;
      winnerInfo.reason = 'Best hand at showdown';
      console.log(`Winner: ${winnerInfo.name} wins $${game.pot} - Best hand at showdown`);
    }
  }
  
  // Store winner info in game object
  game.lastWinner = winnerInfo;
  
  // Change to showdown phase and zero out pot (but keep everything else for display)
  game.pot = 0;
  game.phase = 'showdown';
  
  // Reset player readiness for next hand
  Object.values(game.players).forEach(player => {
    player.isReady = false;
    // Don't reset other player states yet to keep the final state visible
  });
  
  console.log(`Game moved to showdown phase - waiting for players to ready up for next hand`);
  
  // Emit game update with winner info
  Object.keys(game.players).forEach(playerId => {
    io.to(playerId).emit('gameUpdate', {
      game: sanitizeGame(game, playerId)
    });
  });
  
  // Note: We're no longer using setTimeout to automatically transition to waiting
  // Instead, the game will stay in showdown phase until players ready up
  // When all players are ready, startGame will be called which resets the game state
}

// Sanitize game state to send to players
function sanitizeGame(game, playerId = null) {
  // Create a deep copy of the game object to avoid modifying the original
  const sanitized = JSON.parse(JSON.stringify({
    ...game,
    players: {}
  }));
  
  // Hide cards that don't belong to the current player
  Object.entries(game.players).forEach(([id, player]) => {
    // Create a copy of the player object
    const sanitizedPlayer = { ...player };
    
    // If this is not the current player or no player ID is provided, hide the cards
    if (id !== playerId || playerId === null) {
      // Replace actual cards with null values to hide them from other players
      sanitizedPlayer.cards = player.cards.map(() => null);
    }
    
    sanitized.players[id] = sanitizedPlayer;
  });
  
  // Don't send the deck
  delete sanitized.deck;
  
  // Make sure winner info is preserved
  if (game.lastWinner) {
    sanitized.lastWinner = game.lastWinner;
  }
  
  // Log the sanitized game state for debugging (temporary)
  console.log(`Sending game state to player ${playerId}, visible cards: ${playerId ? JSON.stringify(game.players[playerId]?.cards) : 'none'}`);
  
  return sanitized;
}

// Clean up expired games (older than 3 hours)
setInterval(() => {
  const now = Date.now();
  Object.keys(games).forEach(gameId => {
    if (now - games[gameId].createdAt > 3 * 60 * 60 * 1000) {
      delete games[gameId];
    }
  });
  
  // Also clean up disconnected players older than 10 minutes
  Object.keys(disconnectedPlayers).forEach(playerId => {
    if (now - disconnectedPlayers[playerId].disconnectedAt > 10 * 60 * 1000) {
      delete disconnectedPlayers[playerId];
    }
  });
}, 15 * 60 * 1000); // Check every 15 minutes

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});