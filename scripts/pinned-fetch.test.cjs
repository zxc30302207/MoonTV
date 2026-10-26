/* Local-only socket tests. Run: node --test scripts/pinned-fetch.test.cjs */
const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Compile the actual checked-in transport, not a copied implementation.
const source = path.resolve(__dirname, '../src/lib/pinned-fetch.ts');
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const mod = new Module(source, module);
mod.filename = source;
mod.paths = Module._nodeModulePaths(path.dirname(source));
mod._compile(compiled, source);
const { createPinnedLookup, pinnedFetch } = mod.exports;
const addresses = [{ address: '127.0.0.1', family: 4 }];

async function serve(server, run) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('pinned lookup returns only its immutable validated candidates', async () => {
  const source = [
    { address: '93.184.216.34', family: 4 },
    { address: '2001:4860:4860::8888', family: 6 },
  ];
  const lookup = createPinnedLookup('media.test', source);
  source[0].address = '127.0.0.1';
  const call = (name, options) =>
    new Promise((resolve, reject) =>
      lookup(name, options, (error, address, family) =>
        error ? reject(error) : resolve([address, family])
      )
    );
  assert.deepEqual(await call('media.test', { all: true }), [
    [
      { address: '93.184.216.34', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ],
    undefined,
  ]);
  assert.deepEqual(await call('media.test', { family: 6 }), [
    '2001:4860:4860::8888',
    6,
  ]);
  await assert.rejects(call('other.test', {}), /mismatch/);
});

test('real HTTP socket pins an unresolvable hostname and preserves Host, signed query, Range', async () => {
  const server = http.createServer((req, res) => {
    assert.match(req.headers.host, /^media\.invalid:\d+$/);
    assert.equal(req.url, '/seg.ts?sig=a%2Fb&order=2&order=1');
    assert.equal(req.headers.range, 'bytes=0-4');
    res.writeHead(206, { 'Content-Range': 'bytes 0-4/10' });
    res.end('abcde');
  });
  await serve(server, async (port) => {
    const { getGlobalDispatcher, setGlobalDispatcher } = require('undici');
    const old = getGlobalDispatcher();
    setGlobalDispatcher({
      dispatch() {
        throw new Error('global dispatcher must not run');
      },
    });
    try {
      const response = await pinnedFetch(
        new URL(
          `http://media.invalid:${port}/seg.ts?sig=a%2Fb&order=2&order=1`
        ),
        addresses,
        { headers: { Range: 'bytes=0-4' } }
      );
      assert.equal(response.status, 206);
      assert.equal(await response.text(), 'abcde');
      assert.equal(response.headers.get('content-range'), 'bytes 0-4/10');
      assert.match(response.url, /sig=a%2Fb/);
    } finally {
      setGlobalDispatcher(old);
    }
  });
});

test('downstream cancellation closes the actual streaming socket', async () => {
  let closed;
  const closedPromise = new Promise((resolve) => {
    closed = resolve;
  });
  const server = http.createServer((req, res) => {
    req.socket.once('close', closed);
    res.writeHead(200);
    res.write('first chunk');
  });
  await serve(server, async (port) => {
    const response = await pinnedFetch(
      new URL(`http://media.invalid:${port}/`),
      addresses,
      {}
    );
    await response.body.cancel();
    await Promise.race([
      closedPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('socket did not close')),
          2000
        ).unref()
      ),
    ]);
  });
});

test('HTTPS retains SNI and rejects an untrusted certificate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-pinned-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=media.invalid',
        '-addext',
        'subjectAltName=DNS:media.invalid',
      ],
      { stdio: 'ignore' }
    );
    let sni;
    const server = https.createServer(
      {
        key: fs.readFileSync(path.join(dir, 'key.pem')),
        cert: fs.readFileSync(path.join(dir, 'cert.pem')),
        SNICallback(name, callback) {
          sni = name;
          callback(
            null,
            require('node:tls').createSecureContext({
              key: fs.readFileSync(path.join(dir, 'key.pem')),
              cert: fs.readFileSync(path.join(dir, 'cert.pem')),
            })
          );
        },
      },
      (_req, res) => res.end('tls')
    );
    server.on('tlsClientError', () => undefined);
    await serve(server, async (port) => {
      await assert.rejects(
        pinnedFetch(new URL(`https://media.invalid:${port}/`), addresses, {}),
        (error) => error.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
      );
      assert.equal(sni, 'media.invalid');
      // Trust only this test fixture in a fresh Node child. Correct-host TLS must
      // succeed while a different hostname still fails certificate validation.
      const childCode = `
        const fs = require('node:fs'), Module = require('node:module'), path = require('node:path');
        const source = process.argv[1];
        const ts = require('typescript');
        const mod = new Module(source, module); mod.filename = source; mod.paths = Module._nodeModulePaths(path.dirname(source));
        mod._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, source);
        (async () => {
          const addresses = [{address:'127.0.0.1',family:4}];
          const response = await mod.exports.pinnedFetch(new URL('https://media.invalid:${port}/'), addresses, {});
          require('node:assert/strict').equal(await response.text(), 'tls');
          await require('node:assert/strict').rejects(mod.exports.pinnedFetch(new URL('https://wrong.invalid:${port}/'), addresses, {}), e => e.cause?.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
        })().catch(e => { console.error(e); process.exitCode = 1; });
      `;
      await require('node:util').promisify(execFile)(
        process.execPath,
        ['-e', childCode, source],
        {
          cwd: path.resolve(__dirname, '..'),
          env: {
            ...process.env,
            NODE_EXTRA_CA_CERTS: path.join(dir, 'cert.pem'),
          },
        }
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
