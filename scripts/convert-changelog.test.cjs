const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, 'convert-changelog.js');
function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}
test('version generation is idempotent, safely escapes content, and checks without writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-version-'));
  try {
    fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.husky'));
    fs.writeFileSync(
      path.join(dir, 'CHANGELOG'),
      '## [4.7.0] - 2026-10-24\n\n### Added\n- User\'s \\\\ path "quoted" 中文\n'
    );
    fs.writeFileSync(path.join(dir, 'VERSION.txt'), '4.6.0\n');
    fs.writeFileSync(
      path.join(dir, 'src/lib/version.ts'),
      "const CURRENT_VERSION = '4.6.0';\nexport const custom = true;\n"
    );
    let result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const files = ['VERSION.txt', 'src/lib/version.ts', 'src/lib/changelog.ts'];
    const snapshot = files.map((file) =>
      fs.readFileSync(path.join(dir, file), 'utf8')
    );
    assert.equal(snapshot[0], '4.7.0\n');
    assert.match(snapshot[1], /export const custom = true/);
    assert.match(snapshot[2], /User/);
    result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      files.map((file) => fs.readFileSync(path.join(dir, file), 'utf8')),
      snapshot
    );
    assert.equal(run(dir, '--check').status, 0);
    fs.writeFileSync(path.join(dir, 'VERSION.txt'), '4.6.0\n');
    assert.equal(run(dir, '--check').status, 1);
    assert.equal(
      fs.readFileSync(path.join(dir, 'VERSION.txt'), 'utf8'),
      '4.6.0\n'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
