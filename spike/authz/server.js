// Phase 0 spike: minimal forward_auth endpoint.
// Maps an opaque token -> a real path. The client NEVER supplies a path,
// which is what makes traversal structurally impossible.
const http = require('node:http');

const TOKENS = {
  goodtoken:  '/media/big.bin',
  smalltoken: '/media/small.txt',
  revoked:    null,
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/internal/authz') {
    res.writeHead(404).end();
    return;
  }

  const original = req.headers['x-forwarded-uri'] || '';
  console.log(JSON.stringify({
    msg: 'authz', original,
    method: req.headers['x-forwarded-method'],
    seen: Object.keys(req.headers),
  }));

  const m = original.match(/^\/dl\/([^/]+)(?:\/|$)/);
  const target = m ? TOKENS[m[1]] : undefined;

  if (!target) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('denied\n');
    return;
  }
  res.writeHead(200, {
    'X-Accel-Path': target,
    'X-Token-Ok': m[1],
  }).end();
}).listen(3000, () => console.log('authz on :3000'));
