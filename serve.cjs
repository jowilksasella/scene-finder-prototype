// Local preview server with byte-range support, so the browser can seek inside the video.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mp4':'video/mp4','.jpg':'image/jpeg','.png':'image/png','.txt':'text/plain; charset=utf-8'};
const server = http.createServer((req, res) => {
  const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(target).size;
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1;
  if (match) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (start >= size || end < start) { res.writeHead(416, {'Content-Range':`bytes */${size}`}); res.end(); return; }
  const headers = {'Content-Type':types[path.extname(target)] || 'application/octet-stream','Accept-Ranges':'bytes','Content-Length':end - start + 1,'Cache-Control':'no-store'};
  if (match) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(match ? 206 : 200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(target, {start,end}).pipe(res);
});
server.listen(Number(process.env.PORT || 8291), '127.0.0.1', () => console.log(`Preview ready at http://127.0.0.1:${server.address().port}/`));
