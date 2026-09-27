// tools/check_droid_pins.py is the machine check behind the Droid pin policy.
// These tests build factory fixtures under mkdtemp and spawn the real CLI
// against them plus the repo's models.json, so they exercise the surface the
// operator runs. python3 is a build-time dependency of the check, not of the
// plugin, so the suite skips cleanly where it is not installed.
import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../tools/check_droid_pins.py', import.meta.url));
const modelsJson = fileURLToPath(new URL('../plugins/pstack/models.json', import.meta.url));
const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

const python3 = spawnSync('python3', ['--version']).status === 0;
const pinsTest = (name, fn) => test.skipIf(!python3)(`${name} (skipped without python3)`, fn);

function createFactory(settings, droids) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'droid-pins-test-')));
  fixtures.push(dir);
  if (settings !== undefined) writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  if (droids !== undefined) {
    mkdirSync(join(dir, 'droids'));
    for (const [name, fields] of Object.entries(droids)) {
      const frontmatter = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
      writeFileSync(join(dir, 'droids', name), `---\n${frontmatter}\n---\nbody\n`);
    }
  }
  return dir;
}

function runPins(factoryDir) {
  return spawnSync('python3', [script, '--factory-dir', factoryDir, '--models-json', modelsJson], {
    encoding: 'utf8',
  });
}

pinsTest('accepts a clean factory fixture beside the repo droid section', () => {
  const factory = createFactory(
    {
      sessionDefaultSettings: { model: 'glm-5.3', reasoningEffort: 'high' },
      subagentModelSettings: { lightModel: 'glm-5.3-flash', lightReasoningEffort: 'high' },
    },
    {
      'pstack-panel-zhipu.md': { model: '"glm-5.3"', reasoningEffort: 'high' },
      'helper.md': { model: 'inherit' },
    },
  );
  const result = runPins(factory);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /FILTER_OK/);
  assert.match(result.stdout, /pins=\d+ max=\d+\.\d{2}x/);
  assert.match(result.stdout, /settings:sessionDefaultSettings\.model/);
  assert.match(result.stdout, /droid:pstack-panel-zhipu\.md/);
  assert.match(result.stdout, /droid:helper\.md/);
  assert.match(result.stdout, /models-json:droid\.default/);
});

pinsTest('rejects banned slugs and invalid efforts with numbered reasons', () => {
  const factory = createFactory(
    { missionModelSettings: { workerModel: 'glm-5.2', workerReasoningEffort: 'turbo' } },
    {
      'bad-sonnet.md': { model: 'claude-sonnet-5' },
      'bad-gemini.md': { model: 'gemini-3.1-pro-preview' },
    },
  );
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /claude-sonnet-\* banned/);
  assert.match(result.stdout, /Gemini Pro banned/);
  assert.match(result.stdout, /dominated by glm-5\.3/);
  assert.match(result.stdout, /invalid reasoningEffort 'turbo'/);
  assert.match(result.stdout, / 1\. /);
});
