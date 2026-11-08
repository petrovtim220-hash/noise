import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const rooms = new Map();
const soundCloudTracks = [
  { id: 201, title: 'Нон стоп' },
  { id: 202, title: 'Любимая песня твоей сестры' },
  { id: 203, title: 'Адская колыбельная' },
];
const soundCloudUploader = 'poshlaymolliii';
let soundCloudToken = null;
let soundCloudTokenExpiresAt = 0;

async function getSoundCloudToken() {
  if (!process.env.SOUNDCLOUD_CLIENT_ID || !process.env.SOUNDCLOUD_CLIENT_SECRET) {
    const error = new Error('SoundCloud API не настроен: добавьте SOUNDCLOUD_CLIENT_ID и SOUNDCLOUD_CLIENT_SECRET в Render.');
    error.status = 503;
    throw error;
  }
  if (soundCloudToken && Date.now() < soundCloudTokenExpiresAt - 60_000) return soundCloudToken;
  const credentials = Buffer.from(`${process.env.SOUNDCLOUD_CLIENT_ID}:${process.env.SOUNDCLOUD_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${credentials}` },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`SoundCloud OAuth error (${response.status})`);
  soundCloudToken = payload.access_token;
  soundCloudTokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  return soundCloudToken;
}

async function soundCloudRequest(path) {
  const token = await getSoundCloudToken();
  const response = await fetch(`https://api.soundcloud.com${path}`, {
    headers: { accept: 'application/json; charset=utf-8', authorization: `OAuth ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SoundCloud API error (${response.status})`);
  return body;
}

async function findSoundCloudTrack(trackId) {
  const wanted = soundCloudTracks.find((track) => track.id === Number(trackId));
  if (!wanted) return null;
  const query = new URLSearchParams({ q: wanted.title, access: 'playable', limit: '50', linked_partitioning: 'true' });
  const result = await soundCloudRequest(`/tracks?${query}`);
  const tracks = Array.isArray(result) ? result : result.collection || [];
  return tracks.find((track) => track.access === 'playable'
    && track.user?.permalink?.toLowerCase() === soundCloudUploader
    && track.title?.trim().toLocaleLowerCase('ru') === wanted.title.toLocaleLowerCase('ru')) || null;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/vendor/hls.min.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    fs.createReadStream(new URL('./node_modules/hls.js/dist/hls.min.js', import.meta.url)).pipe(res);
    return;
  }
  if (requestUrl.pathname === '/api/soundcloud/track') {
    (async () => {
      const track = await findSoundCloudTrack(requestUrl.searchParams.get('id'));
      if (!track) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'На официальном профиле SoundCloud нет доступного полного потока этой песни.' }));
        return;
      }
      const transcodings = track.media?.transcodings || [];
      const transcoding = transcodings.find((item) => item.format?.protocol === 'progressive')
        || transcodings.find((item) => item.format?.protocol === 'hls' && item.format?.mime_type?.includes('aac'));
      if (!transcoding) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'SoundCloud не разрешает полный поток этой песни для внешнего плеера.' }));
        return;
      }
      const token = await getSoundCloudToken();
      const streamResponse = await fetch(transcoding.url, {
        headers: { accept: 'application/json; charset=utf-8', authorization: `OAuth ${token}` },
        redirect: 'manual',
      });
      let streamUrl = streamResponse.headers.get('location');
      if (!streamUrl && streamResponse.ok) {
        const streamData = await streamResponse.json().catch(() => ({}));
        streamUrl = streamData.url || null;
      }
      if (!streamUrl || !/^https:\/\//i.test(streamUrl)) throw new Error(`SoundCloud stream URL error (${streamResponse.status})`);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      const catalogTrack = soundCloudTracks.find((item) => item.title.toLocaleLowerCase('ru') === track.title.toLocaleLowerCase('ru'));
      res.end(JSON.stringify({ id: catalogTrack.id, title: track.title, artist: track.user.username, permalinkUrl: track.permalink_url, artworkUrl: track.artwork_url, protocol: transcoding.format.protocol, mimeType: transcoding.format.mime_type, streamUrl }));
    })().catch((error) => {
      const status = error.status || 502;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'Не удалось получить поток SoundCloud.' }));
    });
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
