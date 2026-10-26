const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) =>
  fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
function stepRun(workflow, name) {
  const step = workflow
    .split(`      - name: ${name}\n`)[1]
    ?.split('\n      - name: ')[0];
  assert.ok(step, `Missing step ${name}`);
  const body = step.split('        run: |\n')[1];
  assert.ok(body, `Missing run script ${name}`);
  return body
    .split('\n')
    .map((line) => line.replace(/^          /, ''))
    .join('\n');
}

test('a public release is created only after verified build and artifact upload', () => {
  const workflow = read('release.yml');
  const names = [
    'Verify version files',
    'Build project',
    'Upload build artifacts',
    'Create Release',
  ];
  const positions = names.map((name) => workflow.indexOf(`- name: ${name}`));
  positions.forEach((position) => assert.ok(position >= 0));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions
  );
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|if:\s*always\(\)/);
});

test('Docker tag validation accepts compatible tags and rejects unsafe or empty output', () => {
  const workflow = read('docker-build.yml');
  const script = stepRun(workflow, 'Validate image tag');
  assert.doesNotMatch(script, /\$\{\{/);
  assert.ok(
    workflow.indexOf('- name: Validate image tag') <
      workflow.indexOf('- name: 登录到 GitHub Container Registry')
  );
  const run = (tag, latest = 'false') =>
    spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, VERSION_TAG: tag, INCLUDE_LATEST: latest },
      encoding: 'utf8',
    });
  for (const tag of ['v1.0.0', 'v4.7.5-rc.1', 'test_tag', 'a'.repeat(128)]) {
    assert.equal(run(tag).status, 0, tag);
  }
  assert.equal(run('', 'true').status, 0);
  for (const tag of [
    '',
    '-bad',
    '.bad',
    'a'.repeat(129),
    'v1\ninjected',
    'v1,type=raw',
    '$(echo injected)',
    'v1"; exit 0; #',
  ]) {
    assert.notEqual(run(tag).status, 0, tag);
  }
});

test('summary treats input as data and supports spaces in its output path', () => {
  const script = stepRun(read('docker-build.yml'), '输出镜像信息');
  assert.doesNotMatch(script, /\$\{\{/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moontv-release-'));
  try {
    const output = path.join(dir, 'step summary.md');
    const marker = path.join(dir, 'unexpected');
    const tag = `$(touch ${marker})`;
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: {
        ...process.env,
        IMAGE_TAGS: 'ghcr.io/example/app:v1',
        VERSION_TAG: tag,
        INCLUDE_LATEST: 'false',
        GITHUB_STEP_SUMMARY: output,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false);
    assert.ok(fs.readFileSync(output, 'utf8').includes(tag));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
