const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const SITE_URL = 'https://noise-room-site.onrender.com/';
let mainWindow;
const libraryFile = () => path.join(app.getPath('userData'), 'music-library.json');
ipcMain.handle('noise:library:load', async () => {
  try { return JSON.parse(await fs.readFile(libraryFile(), 'utf8')); } catch { return {}; }
});
ipcMain.handle('noise:library:save', async (_event, value) => {
  const json = JSON.stringify(value);
  if (json.length > 1_000_000) throw new Error('Music library is too large');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(libraryFile(), json, 'utf8');
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#101010',
    title: 'NOISE — музыка рядом',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      :root{--bg:#0a0d12;--panel:rgba(255,255,255,.055);--panel2:rgba(255,255,255,.085);--line:rgba(255,255,255,.12);--text:#f7f8fb;--muted:#a9b0bc}
      body{background:radial-gradient(ellipse at 72% 0%,rgba(100,130,180,.14),transparent 38%),linear-gradient(145deg,#0b0f15,#10131a 58%,#0b0d12)!important;color:var(--text)}
      .sidebar,.topbar,.player{background:rgba(17,21,29,.68)!important;backdrop-filter:blur(28px) saturate(165%)!important;-webkit-backdrop-filter:blur(28px) saturate(165%)!important;border-color:var(--line)!important}
      .sidebar{box-shadow:inset -1px 0 rgba(255,255,255,.035)}
      .topbar{box-shadow:0 1px rgba(255,255,255,.035)}
      .player{box-shadow:0 -16px 48px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.1)!important}
      .hero,.track-card,.row,.room-info,.room-bar input,.auth-card{background:rgba(255,255,255,.045)!important;border:1px solid rgba(255,255,255,.1)!important;backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);box-shadow:inset 0 1px rgba(255,255,255,.055),0 12px 36px rgba(0,0,0,.13)}
      .hero{background:linear-gradient(120deg,rgba(255,255,255,.09),rgba(255,255,255,.025) 68%)!important}
      .track-card{padding:10px;border-radius:16px;transition:transform .2s ease,border-color .2s ease,background .2s ease}
      .track-card:hover{transform:translateY(-3px);background:rgba(255,255,255,.085)!important;border-color:rgba(255,255,255,.2)!important}
      .cover,.row-thumb,.now-cover,.avatar{border:1px solid rgba(255,255,255,.13);box-shadow:inset 0 1px rgba(255,255,255,.16),0 8px 24px rgba(0,0,0,.24)}
      button,.chip,.search{transition:background .18s ease,border-color .18s ease,transform .18s ease}
      .chip{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.13)}
      .chip.active,.chip:hover{background:rgba(255,255,255,.88);border-color:transparent}
      .search{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.12);backdrop-filter:blur(16px)}
      .nav button:hover,.nav button.active{background:rgba(255,255,255,.09)!important}
      .primary{border-radius:999px;box-shadow:0 5px 20px rgba(255,255,255,.12)}
      .range{background:rgba(255,255,255,.18)}
      ::selection{background:rgba(160,190,255,.35)}
      @media(max-width:760px){.player{background:rgba(12,15,21,.84)!important}}
    `);
  });
  mainWindow.loadURL(SITE_URL);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
