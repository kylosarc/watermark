const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 42069;
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = (req.url || '/').split('?')[0].split('#')[0];
    let decoded = '/';
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      decoded = '/';
    }
    // Block path traversal attempts.
    const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(DIST, normalized === '/' ? 'index.html' : normalized);
    // Ensure the resolved path stays inside DIST.
    if (!filePath.startsWith(DIST)) filePath = path.join(DIST, 'index.html');
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      stat = null;
    }
    if (!stat || stat.isDirectory()) filePath = path.join(DIST, 'index.html');
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Static serve error:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Request handler error:', err && err.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Watermark running at http://localhost:${PORT}`);
});
