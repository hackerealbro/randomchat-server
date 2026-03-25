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
  transports: ['websocket', 'polling'],
});

const waitingQueue = [];
const pairs = {};
let onlineCount = 0;

app.get('/', (req, res) => {
  res.send('RandomChat signaling server is running');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    online: onlineCount,
    waiting: waitingQueue.length,
  });
});

function broadcastOnlineCount() {
  io.emit('online_count', onlineCount);
}

function tryMatch(socket) {
  const idx = waitingQueue.indexOf(socket.id);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  if (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift();
    const partnerSocket = io.sockets.sockets.get(partnerId);

    if (!partnerSocket) {
      return tryMatch(socket);
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

io.on('connection', (socket) => {
  onlineCount++;
  broadcastOnlineCount();

  socket.on('find_match', () => {
    tryMatch(socket);
  });

  socket.on('offer', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('offer', { sdp: data.sdp });
    }
  });

  socket.on('answer', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('answer', { sdp: data.sdp });
    }
  });

  socket.on('ice_candidate', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('ice_candidate', { candidate: data.candidate });
    }
  });

  socket.on('chat_message', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('chat_message', { text: data.text });
    }
  });

  socket.on('typing', () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('stranger_typing');
    }
  });

  socket.on('skip', () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }
    delete pairs[socket.id];
    tryMatch(socket);
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastOnlineCount();

    const qi = waitingQueue.indexOf(socket.id);
    if (qi !== -1) waitingQueue.splice(qi, 1);

    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }
    delete pairs[socket.id];
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
