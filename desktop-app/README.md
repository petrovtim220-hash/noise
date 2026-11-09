# NOISE for Windows

This Electron shell opens the public NOISE site in its own desktop window. It keeps Node.js APIs disabled in the page and opens external links in the default browser.

To run from source, install Node.js 22 or newer, then run `npm install` and `npm start` in this folder. To create a Windows installer, run `npm run build:win`; the installer is written to `dist`.

The app uses the hosted site, so signing in and listening require an internet connection. Audius search, streaming, queues, favorites, and playlists run in the hosted renderer. The Electron preload saves the music library in the app user-data folder; browser sessions fall back to localStorage. Changes to the hosted site appear in the app after restart or refresh.
