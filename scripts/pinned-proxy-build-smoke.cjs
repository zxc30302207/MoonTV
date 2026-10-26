/* Run after `pnpm build`: node scripts/pinned-proxy-build-smoke.cjs.
 * Local synthetic authentication + local fixtures only. No production secrets.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '..');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });

async function main() {
  assert.ok(
    fs.existsSync(path.join(root, '.next/BUILD_ID')),
    'Build the application first'
  );
  for (const file of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
  ]) {
    assert.ok(
      !fs.existsSync(path.join(root, file)),
      `Refusing smoke with ${file}; use a clean build checkout`
    );
  }
  const seen = [];
  let streamClosed;
  const streamClosedPromise = new Promise((resolve) => {
    streamClosed = resolve;
  });
  const fixture = http.createServer((req, res) => {
    seen.push({ url: req.url, range: req.headers.range });
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/image-start') {
      res.writeHead(302, { Location: '/image.png?sig=a%2Fb&k=2&k=1' });
      res.end();
    } else if (pathname === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    } else if (pathname === '/playlist-start') {
      res.writeHead(307, { Location: '/media/index.m3u8?sig=playlist%2Fok' });
      res.end();
    } else if (pathname === '/media/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg.ts?sig=a%2Fb&k=2&k=1\n#EXT-X-ENDLIST\n'
      );
    } else if (pathname === '/media/seg.ts') {
      if (req.headers.range === 'bytes=2-5') {
        res.writeHead(206, {
          'Content-Range': 'bytes 2-5/10',
          'Content-Length': '4',
          'Accept-Ranges': 'bytes',
        });
        res.end('2345');
      } else {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end('0123456789');
      }
    } else if (pathname === '/stream') {
      req.socket.once('close', streamClosed);
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(Buffer.alloc(4096, 7));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const upstreamPort = await listen(fixture);
  const reserved = http.createServer();
  const appPort = await listen(reserved);
  await close(reserved);
  const base = `http://127.0.0.1:${appPort}`;
  const upstream = `http://127.0.0.1:${upstreamPort}`;
  const password = randomBytes(24).toString('hex');
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(appPort),
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
        PASSWORD: password,
        USERNAME: 'local-smoke-owner',
        ALLOW_PRIVATE_NETWORKS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  try {
    let ready = false;
    for (let count = 0; count < 100; count++) {
      if (child.exitCode !== null)
        throw new Error(`Next exited ${child.exitCode}: ${logs}`);
      try {
        const res = await fetch(`${base}/login`);
        await res.arrayBuffer();
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (_) {
        /* waiting for bind */
      }
      await delay(100);
    }
    assert.ok(ready, `Next did not become ready: ${logs}`);
    const imagePath = `/api/image-proxy?url=${encodeURIComponent(
      `${upstream}/image-start`
    )}`;
    assert.equal((await fetch(base + imagePath)).status, 401);
    assert.equal(seen.length, 0, 'Anonymous request must not hit upstream');
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    assert.equal(
      login.status,
      200,
      `Synthetic login failed: ${await login.clone().text()}`
    );
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'Missing synthetic auth cookie');
    const headers = { Cookie: cookie };
    const image = await fetch(base + imagePath, { headers });
    assert.equal(image.status, 200, await image.clone().text());
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.ok(seen.some((item) => item.url === '/image.png?sig=a%2Fb&k=2&k=1'));
    const playlist = await fetch(
      `${base}/api/m3u8/filter?url=${encodeURIComponent(
        `${upstream}/playlist-start`
      )}`,
      { headers }
    );
    assert.equal(playlist.status, 200, await playlist.clone().text());
    const text = await playlist.text();
    const segment = text
      .split('\n')
      .find((line) => line && !line.startsWith('#'));
    assert.ok(segment, 'Missing filtered segment');
    const segmentUrl = new URL(segment, base);
    const decoded = segmentUrl.href;
    assert.equal(decoded, `${upstream}/media/seg.ts?sig=a%2Fb&k=2&k=1`);
    const range = await fetch(
      `${base}/api/m3u8?url=${encodeURIComponent(decoded)}`,
      {
        headers: { ...headers, Range: 'bytes=2-5' },
      }
    );
    assert.equal(range.status, 206, await range.clone().text());
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await range.text(), '2345');
    assert.ok(
      seen.some(
        (item) =>
          item.range === 'bytes=2-5' &&
          item.url === '/media/seg.ts?sig=a%2Fb&k=2&k=1'
      )
    );
    const controller = new AbortController();
    const stream = await fetch(
      `${base}/api/m3u8?url=${encodeURIComponent(`${upstream}/stream`)}`,
      { headers, signal: controller.signal }
    );
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const first = await reader.read();
    assert.ok(first.value?.byteLength);
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await Promise.race([
      streamClosedPromise,
      delay(5000).then(() => {
        throw new Error('Upstream stream did not close after downstream abort');
      }),
    ]);
    const unsafe = await fetch(
      `${base}/api/image-proxy?url=${encodeURIComponent('file:///etc/passwd')}`,
      { headers }
    );
    assert.equal(unsafe.status, 400);
    console.log(
      JSON.stringify(
        {
          result: 'pass',
          buildId: fs
            .readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8')
            .trim(),
          checks: [
            'anonymous proxy blocked before upstream',
            'synthetic localstorage login',
            'image redirect and exact bytes',
            'playlist final-URL rewrite and signed query',
            '206 Range segment and exact bytes',
            'downstream cancellation closes upstream',
            'non-http target rejected',
          ],
          environment:
            'local production build; controlled local fixtures; no production credentials or Vercel network',
        },
        null,
        2
      )
    );
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(3000),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await close(fixture);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
