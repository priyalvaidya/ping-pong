const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'NEON PONG Server Online', rooms: rooms.size }));
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
  return c;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (e) {}
  }
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  send(room.host, { type: 'disconnect' });
  send(room.guest, { type: 'disconnect' });
  rooms.delete(code);
  console.log(`Room ${code} closed. Active: ${rooms.size}`);
}

wss.on('connection', (ws) => {
  let myRoom = null, myRole = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      case 'create': {
        let code, attempts = 0;
        do { code = genCode(); attempts++; } while (rooms.has(code) && attempts < 100);
        rooms.set(code, { host: ws, guest: null, host_ready: false, guest_ready: false });
        myRoom = code; myRole = 'host';
        send(ws, { type: 'created', code });
        console.log(`Room created: ${code}. Active: ${rooms.size}`);
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { send(ws, { type: 'error', msg: 'Room not found. Check the code.' }); return; }
        if (room.guest) { send(ws, { type: 'error', msg: 'Room is full.' }); return; }
        room.guest = ws; myRoom = code; myRole = 'guest';
        send(room.host, { type: 'matched', role: 'host' });
        send(ws, { type: 'matched', role: 'guest' });
        console.log(`Room ${code} matched!`);
        break;
      }
      case 'ready': {
        const room = rooms.get(myRoom);
        if (!room) return;
        room[myRole + '_ready'] = true;
        if (room.host_ready && room.guest_ready) {
          send(room.host, { type: 'go' });
          send(room.guest, { type: 'go' });
        }
        break;
      }
      case 'paddle': {
        const room = rooms.get(myRoom);
        if (!room) return;
        send(myRole === 'host' ? room.guest : room.host, { type: 'paddle', y: msg.y });
        break;
      }
      case 'state': {
        const room = rooms.get(myRoom);
        if (!room || myRole !== 'host') return;
        send(room.guest, { type: 'state', bx: msg.bx, by: msg.by, bvx: msg.bvx, bvy: msg.bvy, ps: msg.ps, as: msg.as });
        break;
      }
      case 'ability': {
        const room = rooms.get(myRoom);
        if (!room) return;
        const payload = { type: 'ability', id: msg.id, who: myRole };
        send(myRole === 'host' ? room.guest : room.host, payload);
        send(ws, payload);
        break;
      }
      case 'score': {
        const room = rooms.get(myRoom);
        if (!room || myRole !== 'host') return;
        send(room.guest, { type: 'score', ps: msg.ps, as: msg.as });
        break;
      }
      case 'gameover': {
        const room = rooms.get(myRoom);
        if (!room) return;
        send(myRole === 'host' ? room.guest : room.host, { type: 'gameover', winner: msg.winner });
        break;
      }
      case 'taunt': {
        const room = rooms.get(myRoom);
        if (!room) return;
        send(myRole === 'host' ? room.guest : room.host, { type: 'taunt', msg: msg.msg });
        break;
      }
      case 'ping':
        send(ws, { type: 'pong', t: msg.t });
        break;
    }
  });

  ws.on('close', () => { if (myRoom) cleanupRoom(myRoom); });
  ws.on('error', () => { if (myRoom) cleanupRoom(myRoom); });
});

// Cleanup stale rooms every 5 minutes
setInterval(() => {
  rooms.forEach((room, code) => {
    if (!room.host || room.host.readyState !== WebSocket.OPEN) cleanupRoom(code);
  });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEON PONG server on port ${PORT}`));
