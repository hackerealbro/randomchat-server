const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ====== DATA ======
const waitingQueue = [];
const pairs = {};
let onlineCount = 0;

// ====== ROUTES ======
app.get('/', (req, res) => {
  res.send('RandomChat signaling server is running 🚀');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    online: onlineCount,
    waiting: waitingQueue.length,
  });
});

// ====== FUNCTIONS ======
function broadcastOnline() {
  io.emit('online_count', onlineCount);
}

function matchUser(socket) {
  // Kuyruktan çıkar (varsa)
  const index = waitingQueue.indexOf(socket.id);
  if (index !== -1) waitingQueue.splice(index, 1);

  if (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift();
    const partnerSocket = io.sockets.sockets.get(partnerId);

    if (!partnerSocket) {
      return matchUser(socket);
    }

    pairs[socket.id] = partnerId;
    pairs[partnerId] = socket.id;

    socket.emit('matched', { role: 'initiator' });
    partnerSocket.emit('matched', { role: 'receiver' });

  } else {
    waitingQueue.push(socket.id);
    socket.emit('waiting');
  }
}

// ====== SOCKET.IO ======
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  onlineCount++;
  broadcastOnline();

  // Match bul
  socket.on('find_match', () => {
    matchUser(socket);
  });

  // ===== WebRTC =====
  socket.on('offer', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('answer', data);
    }
  });

  socket.on('ice_candidate', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('ice_candidate', data);
    }
  });

  // ===== CHAT =====
  socket.on('chat_message', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('chat_message', data);
    }
  });

  socket.on('typing', () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('stranger_typing');
    }
  });

  // ===== NEXT =====
  socket.on('skip', () => {
    const partnerId = pairs[socket.id];

    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }

    delete pairs[socket.id];
    matchUser(socket);
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    onlineCount = Math.max(0, onlineCount - 1);
    broadcastOnline();

    const index = waitingQueue.indexOf(socket.id);
    if (index !== -1) waitingQueue.splice(index, 1);

    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }

    delete pairs[socket.id];
  });
});

// ====== START ======
const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🔥 Signaling server running on port ${PORT}`);
});
