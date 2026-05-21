const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ── Rooms store ──
const rooms = {};

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ── HTTP server (handles both HTTP and WS upgrades) ──
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'NEON PONG Server Online', rooms: Object.keys(rooms).length }));
});

// ── WebSocket server attached to same HTTP server ──
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create': {
        let code;
        do { code = makeCode(); } while (rooms[code]);
        rooms[code] = { host: ws, guest: null };
        ws.roomCode = code;
        ws.role = 'host';
        ws.send(JSON.stringify({ type: 'created', code }));
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms[code];
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' }));
          break;
        }
        if (room.guest) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
          break;
        }
        room.guest = ws;
        ws.roomCode = code;
        ws.role = 'guest';
        // Tell both players they matched
        room.host.send(JSON.stringify({ type: 'matched', role: 'host' }));
        room.guest.send(JSON.stringify({ type: 'matched', role: 'guest' }));
        // Signal game start after short delay
        setTimeout(() => {
          if (room.host.readyState === 1) room.host.send(JSON.stringify({ type: 'go' }));
          if (room.guest.readyState === 1) room.guest.send(JSON.stringify({ type: 'go' }));
        }, 800);
        break;
      }

      case 'paddle':
      case 'state':
      case 'ability':
      case 'gameover':
      case 'taunt': {
        // Relay to the other player in the room
        const room = rooms[ws.roomCode];
        if (!room) break;
        const other = ws.role === 'host' ? room.guest : room.host;
        if (other && other.readyState === 1) other.send(JSON.stringify(msg));
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
      }
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const other = ws.role === 'host' ? room.guest : room.host;
    if (other && other.readyState === 1) {
      other.send(JSON.stringify({ type: 'disconnect' }));
    }
    delete rooms[code];
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`NEON PONG server running on port ${PORT}`);
});
