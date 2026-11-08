import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const rooms = new Map();
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(new URL('./index.html', import.meta.url)).pipe(res);
    return;
  }
  res.writeHead(404).end('Not found');
});
const wss = new WebSocketServer({ server });
const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
function broadcast(room, message) {
  for (const client of room.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ ...message, users: room.clients.size }));
  }
}
function leaveRoom(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.clients.delete(ws);
  if (room.host === ws) {
    broadcast(room, { type: 'closed' });
    rooms.delete(ws.roomId);
  } else {
    broadcast(room, { type: 'users' });
  }
  ws.roomId = null;
}
wss.on('connection', (ws) => {
  ws.on('message', (buffer) => {
    let message;
    try { message = JSON.parse(buffer.toString()); } catch { return; }

    if (message.type === 'create') {
      leaveRoom(ws);
      let roomId = String(message.roomId || makeCode()).toUpperCase();
      if (!message.roomId) while (rooms.has(roomId)) roomId = makeCode();
      let room = rooms.get(roomId);
      if (!room) {
        room = { clients: new Set(), state: {}, host: ws };
        rooms.set(roomId, room);
      }
      room.host = ws;
      room.clients.add(ws);
      ws.roomId = roomId;
      ws.send(JSON.stringify({ type: 'created', roomId, users: room.clients.size }));
      return;
    }

    if (message.type === 'join') {
      leaveRoom(ws);
      const roomId = String(message.roomId || '').toUpperCase();
      const room = rooms.get(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена: создатель должен подключиться первым' }));
        return;
      }
      ws.roomId = roomId;
      room.clients.add(ws);
      ws.send(JSON.stringify({ type: 'joined', roomId, state: room.state, users: room.clients.size }));
      broadcast(room, { type: 'users' });
      return;
    }

    const room = rooms.get(ws.roomId);
    if (room && room.host === ws && ['play', 'pause', 'seek', 'track'].includes(message.type)) {
      room.state = { ...room.state, ...message };
      broadcast(room, { type: 'sync', state: room.state });
    }
  });
  ws.on('close', () => leaveRoom(ws));
});
server.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('NOISE listening'));
