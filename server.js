import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { WebSocketServer } from 'ws';

const rooms = new Map();
const AUDIUS_API = 'https://api.audius.co/v1';
async function audiusRequest(endpoint) {
  const response = await fetch(`${AUDIUS_API}${endpoint}`, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.errors?.[0]?.message || `Audius API error (${response.status})`);
  return payload.data;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/api/audius/search') {
    (async () => {
      const query = String(requestUrl.searchParams.get('q') || '').trim();
      if (query.length < 2) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end('{"tracks":[]}'); return; }
      const results = await audiusRequest(`/tracks/search?${new URLSearchParams({ query, limit: '30' })}`);
      const tracks = (Array.isArray(results) ? results : []).filter((track) => track.is_streamable && track.is_available !== false).map((track) => ({
        id: track.id, title: track.title, artist: track.user?.name || track.user?.handle || 'Audius artist', album: track.album_backlink?.title || track.playlist_name || 'Сингл', duration: Number(track.duration) || 0,
        coverUrl: track.artwork?.['480x480'] || track.artwork?.['150x150'] || '', permalink: track.permalink ? `https://audius.co${track.permalink}` : 'https://audius.co', provider: 'audius', src: `/api/audius/stream?id=${encodeURIComponent(track.id)}`,
      }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ tracks }));
    })().catch((error) => { res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: error.message || 'Audius search failed' })); });
    return;
  }
  if (requestUrl.pathname === '/api/audius/stream') {
    (async () => {
      const id = String(requestUrl.searchParams.get('id') || '');
      if (!/^[a-zA-Z0-9]+$/.test(id)) { res.writeHead(400).end('Invalid track ID'); return; }
      const upstream = await fetch(`${AUDIUS_API}/tracks/${encodeURIComponent(id)}/stream`, { redirect: 'manual' });
      const destination = upstream.headers.get('location');
      if (upstream.status >= 300 && upstream.status < 400 && destination && /^https:\/\//i.test(destination)) {
        res.writeHead(302, { location: destination, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(); return;
      }
      if (!upstream.ok) throw new Error(`Audius stream unavailable (${upstream.status})`);
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      upstream.body.pipeTo(Writable.toWeb(res)).catch(() => res.destroy());
    })().catch((error) => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(error.message || 'Audius stream failed'); } });
    return;
  }
  if (req.url === '/config') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' }));
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(new URL('./index.html', import.meta.url)).pipe(res);
    return;
  }
  if (requestUrl.pathname.startsWith('/covers/')) {
    const name = path.basename(decodeURIComponent(requestUrl.pathname));
    if (!/^[a-z0-9-]+\.jpg$/i.test(name)) { res.writeHead(404).end(); return; }
    const file = new URL(`./covers/${name}`, import.meta.url);
    fs.stat(file, (error, stat) => {
      if (error) { res.writeHead(404).end('Cover not found'); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': stat.size, 'cache-control': 'public, max-age=31536000, immutable' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  if (requestUrl.pathname.startsWith('/tracks/')) {
    const name = path.basename(decodeURIComponent(requestUrl.pathname));
    if (!name.toLowerCase().endsWith('.mp3')) { res.writeHead(404).end(); return; }
    const file = new URL(`./tracks/${name}`, import.meta.url);
    fs.stat(file, (error, stat) => {
      if (error) { res.writeHead(404).end('Track not found'); return; }
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end(); return; }
        let start = Number(match[1] || 0);
        let end = Number(match[2] || stat.size - 1);
        if (start >= stat.size || end < start) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end(); return; }
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1, 'cache-control': 'public, max-age=31536000' });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-length': stat.size, 'cache-control': 'public, max-age=31536000' });
      fs.createReadStream(file).pipe(res);
    });
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
