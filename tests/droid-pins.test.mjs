// tools/check_droid_pins.py is the machine check behind the Droid pin policy.
// These tests build factory fixtures under mkdtemp and spawn the real CLI
// against them plus the repo's models.json, so they exercise the surface the
// operator runs. Every rule the lever enforces is pinned by a fixture: the
// gauntlet bans, the 2x ceiling, the unknown-slug fail, the panel-droid
// invariants, the exact panel-set and tier-slug membership, the three
// different panel slugs across the panel droids, settings list and plural
// keys, frontmatter trailing comments, duplicate model keys, droids hidden
// in subdirectories, stray non-markdown droids files, the empty droid panel
// beside a future mirrored tier, and the explicit-flag failures. The luna
// cheap-worker slugs pass at their audited prices while an unknown luna-
// family slug still fails. python3 is a build-time dependency of the check,
// not of the plugin, so the suite skips cleanly where it is not installed.
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

function runPins(factoryDir, modelsPath = modelsJson) {
  return spawnSync('python3', [script, '--factory-dir', factoryDir, '--models-json', modelsPath], {
    encoding: 'utf8',
  });
}

// The three panel arms every walked droids dir must carry, one personal
// droid per audited panel slug.
const PANEL_ARMS = {
  'pstack-panel-zhipu.md': { model: '"glm-5.3"', reasoningEffort: 'high' },
  'pstack-panel-google.md': { model: 'gemini-3.8-flash', reasoningEffort: 'high' },
  'pstack-panel-grok.md': { model: 'grok-4.7', reasoningEffort: 'high' },
};

pinsTest('accepts a clean factory fixture beside the repo droid section', () => {
  const factory = createFactory(
    {
      sessionDefaultSettings: { model: 'glm-5.3', reasoningEffort: 'high' },
      subagentModelSettings: {
        lightModel: 'glm-5.3-flash',
        lightReasoningEffort: 'high',
        cheapWorkerModels: ['gpt-6-luna', 'gpt-5.6-luna'],
      },
    },
    {
      ...PANEL_ARMS,
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
  assert.match(result.stdout, /gpt-6-luna\s+0\.04x\s+settings:subagentModelSettings\.cheapWorkerModels\[0\]/);
  assert.match(result.stdout, /gpt-5\.6-luna\s+0\.08x\s+settings:subagentModelSettings\.cheapWorkerModels\[1\]/);
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

pinsTest('a slug priced at the 2x ceiling and an unknown slug each fail', () => {
  const factory = createFactory(undefined, {
    'ceiling.md': { model: 'claude-opus-5' },
    'unknown.md': { model: 'glm-6-flash' },
  });
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /banned slug claude-opus-5 at droid:ceiling\.md: over budget at 2x/);
  assert.match(result.stdout, /over ceiling claude-opus-5 \(2\.0x\) at droid:ceiling\.md/);
  assert.match(result.stdout, /unknown slug glm-6-flash at droid:unknown\.md/);
});

pinsTest('the luna cheap-worker slugs pass at their audited prices', () => {
  const factory = createFactory(
    { subagentModelSettings: { workerModel: 'gpt-6-luna', implModel: 'gpt-5.6-luna' } },
    {
      ...PANEL_ARMS,
      'cheap-worker.md': { model: 'gpt-6-luna', reasoningEffort: 'medium' },
    },
  );
  const result = runPins(factory);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /FILTER_OK/);
  assert.match(result.stdout, /gpt-6-luna\s+0\.04x\s+settings:subagentModelSettings\.workerModel/);
  assert.match(result.stdout, /gpt-5\.6-luna\s+0\.08x\s+settings:subagentModelSettings\.implModel/);
  assert.match(result.stdout, /gpt-6-luna\s+0\.04x\s+droid:cheap-worker\.md/);
});

pinsTest('an unknown luna-family slug still fails the gauntlet', () => {
  const factory = createFactory(undefined, { 'near-miss.md': { model: 'gpt-6-luna-pro' } });
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /unknown slug gpt-6-luna-pro at droid:near-miss\.md/);
});

pinsTest('a pstack-panel droid on inherit without an effort fails both invariants', () => {
  const factory = createFactory(
    { sessionDefaultSettings: { model: 'glm-5.3' } },
    { 'pstack-panel-x.md': { model: 'inherit' } },
  );
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /panel droid must pin a non-inherit model at droid:pstack-panel-x\.md/);
  assert.match(result.stdout, /panel droid missing reasoningEffort at droid:pstack-panel-x\.md/);
});

pinsTest('an explicitly passed missing --factory-dir fails instead of skipping', () => {
  const absent = realpathSync(mkdtempSync(join(tmpdir(), 'droid-pins-absent-')));
  rmSync(absent, { recursive: true, force: true });
  const result = runPins(absent);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, / 1\. --factory-dir .* does not exist or is not a directory/);
  assert.doesNotMatch(result.stdout, /skipped:/);
});

pinsTest('an explicitly passed --factory-dir that yields no pins fails', () => {
  const factory = createFactory({}, undefined);
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /--factory-dir .* yielded no pins/);
});

pinsTest('a missing models.json fails', () => {
  const factory = createFactory(
    { sessionDefaultSettings: { model: 'glm-5.3', reasoningEffort: 'high' } },
    { 'helper.md': { model: 'inherit' } },
  );
  const result = runPins(factory, join(factory, 'absent-models.json'));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /models-json missing at /);
});

pinsTest('settings list values are pinned and non-string values fail', () => {
  const factory = createFactory(
    {
      subagentModelSettings: {
        workerModel: ['glm-5.3', 'grok-4.7'],
        workerReasoningEffort: ['high', 'low'],
        brokenModel: 5,
      },
    },
    undefined,
  );
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /settings:subagentModelSettings\.workerModel\[0\]/);
  assert.match(result.stdout, /settings:subagentModelSettings\.workerModel\[1\]/);
  assert.match(result.stdout, /non-string brokenModel value at settings:subagentModelSettings\.brokenModel: 5/);
});

pinsTest('frontmatter trailing comments are stripped and stray droids files fail', () => {
  const factory = createFactory(
    { sessionDefaultSettings: { model: 'glm-5.3' } },
    { 'noted.md': { model: 'glm-5.3 # the medium tier', reasoningEffort: 'high' } },
  );
  writeFileSync(join(factory, 'droids', 'notes.txt'), 'stray\n');
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /non-markdown file in the droids dir at notes\.txt/);
  assert.match(result.stdout, /glm-5\.3\s+0\.56x\s+droid:noted\.md/);
  assert.doesNotMatch(result.stdout, /unknown slug .*noted\.md/);
});

pinsTest('a fixture models.json pins every mirrored tier and fails an empty panel', () => {
  const factory = createFactory(
    { sessionDefaultSettings: { model: 'glm-5.3' } },
    { 'helper.md': { model: 'inherit' } },
  );
  const fixtureModels = join(factory, 'models.json');
  writeFileSync(
    fixtureModels,
    JSON.stringify({
      tiers: { default: 'opus', strongest: 'fable', panel: ['opus'], ultratier: 'haiku' },
      roles: [],
      droid: { default: 'glm-5.3', strongest: 'claude-opus-5-5', panel: [], ultratier: 'grok-4.7' },
    }),
  );
  const result = runPins(factory, fixtureModels);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /empty panel list in the droid section/);
  assert.match(result.stdout, /grok-4\.7\s+0\.80x\s+models-json:droid\.ultratier/);
});

pinsTest('a swapped default/strongest, a four-arm panel, and same-slug panel droids fail membership', () => {
  const factory = createFactory(
    { sessionDefaultSettings: { model: 'glm-5.3' } },
    {
      'pstack-panel-a.md': { model: 'gpt-6-luna', reasoningEffort: 'high' },
      'pstack-panel-b.md': { model: 'gpt-6-luna', reasoningEffort: 'high' },
      'pstack-panel-c.md': { model: 'gpt-6-luna', reasoningEffort: 'high' },
    },
  );
  const fixtureModels = join(factory, 'models.json');
  writeFileSync(
    fixtureModels,
    JSON.stringify({
      tiers: { default: 'opus', strongest: 'fable', panel: ['opus', 'fable', 'sonnet', 'haiku'] },
      roles: [],
      droid: {
        default: 'gpt-5.6-luna',
        strongest: 'gpt-6-luna',
        panel: ['glm-5.3', 'gemini-3.8-flash', 'grok-4.7', 'gpt-6-luna'],
      },
    }),
  );
  const result = runPins(factory, fixtureModels);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(
    result.stdout,
    /droid\.panel must equal the exact panel set \['glm-5\.3', 'gemini-3\.8-flash', 'grok-4\.7'\]/,
  );
  assert.match(result.stdout, /droid\.default must be glm-5\.3 at .*models\.json, got 'gpt-5\.6-luna'/);
  assert.match(result.stdout, /droid\.strongest must be claude-opus-5-5 at .*models\.json, got 'gpt-6-luna'/);
  assert.match(
    result.stdout,
    /panel droid model gpt-6-luna at droid:pstack-panel-a\.md is not in the panel set/,
  );
  assert.match(
    result.stdout,
    /panel droids must pin the three different panel slugs \['glm-5\.3', 'gemini-3\.8-flash', 'grok-4\.7'\], got \['gpt-6-luna'\]/,
  );
});

pinsTest('a duplicate model key fails and pins every value through the gauntlet', () => {
  const factory = createFactory({ sessionDefaultSettings: { model: 'glm-5.3' } }, { ...PANEL_ARMS });
  writeFileSync(
    join(factory, 'droids', 'dup.md'),
    '---\nmodel: claude-fable-5\nmodel: gpt-6-luna\n---\nbody\n',
  );
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /duplicate model key at droid:dup\.md: \['claude-fable-5', 'gpt-6-luna'\]/);
  assert.match(result.stdout, /banned slug claude-fable-5 at droid:dup\.md: over budget at 4x/);
  assert.match(result.stdout, /gpt-6-luna\s+0\.04x\s+droid:dup\.md#model2/);
});

pinsTest('a droid hidden in a subdirectory is still walked', () => {
  const factory = createFactory({ sessionDefaultSettings: { model: 'glm-5.3' } }, { ...PANEL_ARMS });
  mkdirSync(join(factory, 'droids', 'sub'));
  writeFileSync(join(factory, 'droids', 'sub', 'hidden.md'), '---\nmodel: glm-5.2\n---\nbody\n');
  writeFileSync(join(factory, 'droids', 'sub', 'notes.txt'), 'stray\n');
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /banned slug glm-5\.2 at droid:sub\/hidden\.md: dominated by glm-5\.3 at 0\.56x/);
  assert.match(result.stdout, /non-markdown file in the droids dir at sub\/notes\.txt/);
});

pinsTest('plural settings keys are visited so banned slugs inside them fail', () => {
  const factory = createFactory(
    {
      missionModelSettings: {
        workerModels: 'claude-fable-5',
        panelCandidates: ['grok-4.5'],
        fallbackModelList: 'claude-sonnet-5',
        reasoningEfforts: 'gpt-5.5',
      },
    },
    undefined,
  );
  const result = runPins(factory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FILTER_FAIL/);
  assert.match(result.stdout, /banned slug claude-fable-5 at settings:missionModelSettings\.workerModels/);
  assert.match(result.stdout, /banned slug grok-4\.5 at settings:missionModelSettings\.panelCandidates\[0\]/);
  assert.match(result.stdout, /banned slug claude-sonnet-5 at settings:missionModelSettings\.fallbackModelList/);
  assert.match(
    result.stdout,
    /invalid reasoningEffort 'gpt-5\.5' at settings:missionModelSettings\.reasoningEfforts/,
  );
});
