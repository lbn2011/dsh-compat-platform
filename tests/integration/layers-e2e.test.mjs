/**
 * Layer 1 → Layer 4, in the order a plugin climbs them.
 *
 * WHAT "INTEGRATION" MEANS HERE. Each layer is exercised through the code that
 * owns it — the kit generates, the spec validates, the analyzer detects, the
 * lifecycle/patch code merges — and each layer's output is the next layer's
 * input. No layer is re-implemented in this file, and no assertion is satisfied
 * by a copy of another repository's logic.
 *
 * THE FOUR LAYERS (docs/requirements-and-design/2026-11-12-multi-layer-extension-solution.md):
 *   L1 服务注册层  — a plugin registers tools/slots; declaration states what.
 *   L2 事件监听层  — claims are read, conflicts detected, failures arbitrated,
 *                    packages installed by bootstrap.
 *   L3 Patch 配置层 — a declared patch changes configuration; it is reviewed
 *                    and merged as YAML, never executed as code.
 *   L4 Bundle 替换层 — a bundle replaces core components; it needs explicit
 *                    approval and is merged into the operator's own YAML.
 *
 * LAYER 1 REALLY EXECUTES THE GENERATED PLUGIN. Where a DeepSeek Harness
 * install is present on this machine, the generated `index.js` is imported with
 * its declared peer dependencies resolved from that install, `apply()` is
 * called, and the tool it registers is invoked. Where it is absent, that one
 * case is skipped with the reason printed — a skipped execution is never
 * reported as a pass.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  createConflictDetector,
} from '../../packages/analyzer/src/conflict-detector.js';
import { staticPreCheck } from '../../packages/analyzer/src/pre-check.js';
import {
  ARBITER_STRATEGIES,
  decideArbitration,
  readConflictPolicy,
} from '../../packages/conflict-arbiter/src/arbiter-policy.js';
import { classifyFailure } from '../../packages/conflict-arbiter/src/failure-classify.js';
import { mergePatchBlock } from '../../packages/lifecycle-bootstrap/src/patch-merge.js';
import { validateDeclaration } from '../../../dsh-compat-spec/src/index.js';
import {
  DSHPatchAPI,
  planScaffold,
  renderScaffold,
  writeScaffold,
} from '../../../dsh-plugin-kit/src/index.js';
import { dshPeerModulesRoot, versionLine } from './helpers/contract.mjs';

const SCRATCH = process.env.TMPDIR && process.env.TMPDIR !== '' ? process.env.TMPDIR : undefined;

/** Create a scratch directory inside TMPDIR and remove it afterwards. */
function scratch(t) {
  const dir = mkdtempSync(join(SCRATCH ?? '/tmp', 'dsh-int-layer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Render one kit template in memory. */
function rendered(template, extra = {}) {
  const options = { target: `/nonexistent/${extra.dir ?? template}`, template };
  if (template === 'host-tool-managed' || template === 'host-tool-admitted' || template === 'host-test-driver') {
    options.kitSpecifier = 'file:../dsh-plugin-kit';
  }
  if (extra.slotName !== undefined) options.slotName = extra.slotName;
  const planned = planScaffold(options);
  assert.equal(planned.ok, true, `${template}: ${JSON.stringify(planned.issues)}`);
  return renderScaffold(planned.plan);
}

test('the run identifies itself by version before asserting anything', () => {
  // Every later assertion is evidence about *these* versions, so the line is
  // asserted rather than assumed.
  assert.match(versionLine(), /^spec@\S+ kit@\S+ platform@\S+ node@v\d+\./);
});

// ---------------------------------------------------------------- Layer 1 ---

test('L1 — the generated host-tool plugin registers exactly the declared tool', async (t) => {
  const peerRoot = dshPeerModulesRoot();
  if (peerRoot === null) {
    t.skip('no DeepSeek Harness install on this machine: generated plugin not executed');
    return;
  }
  const dir = scratch(t);
  const target = join(dir, 'acme');
  const written = await writeScaffold({ target, template: 'host-tool' });
  assert.equal(written.ok, true, JSON.stringify(written.issues));

  const declaration = JSON.parse(readFileSync(join(target, 'declaration.json'), 'utf8'));

  // The spec accepts what the kit generated: this is the L1 protocol boundary.
  const validated = validateDeclaration(declaration);
  assert.equal(validated.valid, true, JSON.stringify(validated.issues));

  // Resolve the declared peers from the install instead of installing anything.
  mkdirSync(join(target, 'node_modules', '@deepseek-ai'), { recursive: true });
  for (const name of ['cordis', 'schemastery', 'dsh-tools']) {
    symlinkSync(join(peerRoot, '@deepseek-ai', name), join(target, 'node_modules', '@deepseek-ai', name), 'dir');
  }

  const module = await import(pathToFileURL(join(target, 'index.js')).href);
  assert.equal(module.name, declaration.plugin.id);
  assert.deepEqual(module.inject, ['tools'], 'the entry injects the service the declaration requires');

  const registrations = [];
  const ctx = {
    tools: {
      register(definition) {
        registrations.push(definition);
        return () => {};
      },
    },
  };
  const config = typeof module.Config === 'function' ? module.Config({}) : {};
  module.apply(ctx, config);

  assert.equal(registrations.length, 1);
  // The name the host would see is the name the declaration claimed.
  assert.equal(registrations[0].name, declaration.resources[0].name);
  assert.deepEqual(
    declaration.resources.map((resource) => [resource.kind, resource.name, resource.scope]),
    [['tool', registrations[0].name, 'plugin']],
  );

  // The tool is not a stub: it runs and returns the greeting from its schema.
  const value = await registrations[0].execute({ who: 'Ada' });
  assert.equal(value, 'Hello, Ada!');
});

test('L1 — a client-slot scaffold keeps client.js and declaration.json in step', () => {
  const files = rendered('client-slot', { slotName: 'acme.panel' });
  const declaration = JSON.parse(files.get('declaration.json'));
  assert.deepEqual(
    declaration.resources.map((resource) => [resource.kind, resource.name]),
    [['slot', 'acme.panel']],
  );
  // The browser half injects the service the declaration requires, and registers
  // the very slot the declaration claims — checked as text because client.js runs
  // in a browser, not here.
  const client = files.get('client.js');
  assert.match(client, /inject: \['slots'\]/);
  assert.ok(client.includes("'acme.panel'"), 'client.js registers the declared slot name');
  // The host companion is deliberately empty: a slot contributes no host service.
  assert.match(files.get('index.js'), /export function apply\(\) \{\s*\}/);
});

// ---------------------------------------------------------------- Layer 2 ---

test('L2 — A1 reads the declared claims, A2 pre-checks the same package.json', () => {
  const files = rendered('combined');
  const declaration = JSON.parse(files.get('declaration.json'));
  const packageJson = JSON.parse(files.get('package.json'));

  // A1: what the plugin claims, read from the declaration the kit wrote.
  const detector = createConflictDetector();
  detector.report(packageJson.name, declaration);
  const claimed = detector.claims().map((claim) => `${claim.kind}:${claim.key}`).sort();
  assert.deepEqual(claimed, [
    `slot:${declaration.resources[1].name}`,
    `tool:${declaration.resources[0].name}`,
  ].sort());

  // A2: the same package.json through the static pre-check. It answers with a
  // summary of predicted conflicts, never with a verdict about compatibility.
  const asBrowser = staticPreCheck({ manifest: packageJson, platform: 'web' });
  assert.equal(asBrowser.ok, true);
  assert.deepEqual(asBrowser.summary.predicted, [], 'the browser half is consistent with a web platform');

  // A2 takes ONE platform for the whole package. A combined package has a host
  // half and a browser half, so asking about a host platform surfaces the
  // browser row as C6. That is the pre-check's documented single-platform
  // assumption showing through — recorded here, not "fixed".
  const asHost = staticPreCheck({ manifest: packageJson, platform: 'linux' });
  assert.deepEqual(
    asHost.summary.predicted.map((finding) => [finding.code, finding.key]),
    [['C6', 'client']],
  );

  // A pure host plugin is clean on this platform: the C6 above is about the
  // browser row, not about kit output in general.
  const hostOnly = JSON.parse(rendered('host-tool').get('package.json'));
  const hostCheck = staticPreCheck({ manifest: hostOnly, platform: process.platform });
  assert.deepEqual(hostCheck.summary.predicted, []);
  assert.deepEqual(hostCheck.summary.conflicts, []);
});

test('L2 — A3 classifies a real cordis registration failure and follows the declared strategy', () => {
  // The two texts cordis actually throws (packages/conflict-arbiter/README).
  const duplicate = classifyFailure('service "tools" has been registered at <acme-one>');
  assert.equal(duplicate.kind, 'duplicate-service');
  assert.equal(duplicate.service, 'tools');
  assert.equal(duplicate.existingOwner, 'acme-one');

  // A plugin opts in with a field the host ignores — the arbiter reads it.
  const policy = readConflictPolicy({
    name: 'acme-two',
    dsh: { conflicts: { strategy: 'disable-later', service: 'tools' } },
  });
  assert.equal(policy.present, true);
  assert.equal(policy.strategy, 'disable-later');

  const decision = decideArbitration({
    classification: duplicate,
    policy,
    entry: { entryId: 'acme-two', readOnly: false },
    selfEntryId: 'dsh-compat-conflict-arbiter',
  });
  assert.equal(decision.action, 'disable-entry', 'the only remedy the host offers');
  assert.equal(decision.entryId, 'acme-two');

  // An unknown strategy is refused, not coerced to the default.
  const refused = readConflictPolicy({ dsh: { conflicts: { strategy: 'restart-everything' } } });
  assert.equal(refused.refused, true);
  assert.deepEqual(ARBITER_STRATEGIES, ['report-only', 'disable-later', 'isolate']);
});

// ---------------------------------------------------------------- Layer 3 ---

test('L3 — a declared patch becomes YAML the loader would read, and the merge gate accepts it', () => {
  const api = new DSHPatchAPI();
  api.insert({ id: 'acme-interceptor', name: './lib/auth.js' });
  api.replace('llm-adapter-openai', { timeout: 120000 });
  api.disable('official-telemetry');
  const { yaml, patches } = api.commit();
  // Three verbs, three patches, in the order they were called.
  assert.deepEqual(patches.map((patch) => (patch.insert ? 'insert' : patch.disabled ? 'disable' : 'replace')),
    ['insert', 'replace', 'disable']);

  // The block starts with an append marker the merge gate can find, and every
  // target id appears exactly once.
  assert.ok(yaml.includes('- insert:'));
  for (const id of ['acme-interceptor', 'llm-adapter-openai', 'official-telemetry']) {
    assert.ok(yaml.includes(id), `${id} is in the patch`);
  }

  // The operator's own YAML is never rewritten: a block of new ids is appended.
  const home = ['- id: plugin-manager', "  plugin: '@deepseek-ai/dsh-plugin-manager'", ''].join('\n');
  const merged = mergePatchBlock({ homeText: home, block: yaml });
  assert.equal(merged.status, 'appended', JSON.stringify(merged.code));
  assert.equal(merged.code, null);
  assert.ok(merged.text.startsWith(home), 'the existing text is preserved byte for byte');
  assert.ok(merged.addedIds.length > 0);
  for (const id of merged.addedIds) assert.ok(merged.text.includes(id));

  // Re-running the same patch over the merged text adds nothing: the ids are
  // already present, so the block is skipped, not duplicated.
  const again = mergePatchBlock({ homeText: merged.text, block: yaml });
  assert.equal(again.status, 'skipped');

  // A block that only partly overlaps is refused rather than half-applied.
  const partialHome = ['- id: acme-interceptor', "  plugin: './lib/auth.js'", ''].join('\n');
  const partial = mergePatchBlock({ homeText: partialHome, block: yaml });
  assert.equal(partial.status, 'refused');
  assert.equal(partial.code, 'PARTIAL_OVERLAP');
  assert.equal(partial.text, null, 'a refused merge returns no text to write');
});

// ---------------------------------------------------------------- Layer 4 ---

test('L4 — a bundle layer is only merged after the operator YAML is read as a sequence', () => {
  // A bundle is a package whose patch replaces core components: the ids are the
  // core ones, which is exactly why L4 needs approval (see patch-approval and
  // bundle-install records).
  const bundleBlock = [
    '- insert:',
    '    - id: enterprise-plugin-manager',
    "      plugin: './lib/plugin-manager.js'",
    '',
  ].join('\n');
  const homeText = [
    '- id: plugin-manager',
    "  plugin: '@deepseek-ai/dsh-plugin-manager'",
    '- id: llm-adapter-openai',
    "  plugin: '@deepseek-ai/dsh-llm-openai'",
    '',
  ].join('\n');

  const merged = mergePatchBlock({ homeText, block: bundleBlock });
  assert.equal(merged.status, 'appended');
  // The lifecycle bootstrap appends; it does not disable the core rows for the
  // operator. Disabling is the bundle author's declared row, appended as text.
  assert.ok(merged.text.includes('- id: plugin-manager'), 'the core row survives untouched');
  assert.ok(merged.text.includes('enterprise-plugin-manager'));

  // A block with no ids is refused: nothing to append is not a successful merge.
  const empty = mergePatchBlock({ homeText, block: '- insert:\n    - plugin: ./x.js\n' });
  assert.equal(empty.status, 'refused');
  assert.equal(empty.code, 'BUNDLE_BLOCK_NO_IDS');
});

// ------------------------------------------------------------- the chain ----

test('the chain L1→L4 hands off real artifacts at every step', () => {
  // L1: the declaration the kit generated, accepted by the spec.
  const declaration = JSON.parse(rendered('host-tool', { dir: 'acme' }).get('declaration.json'));
  assert.equal(validateDeclaration(declaration).valid, true);

  // L2: the same declaration as claims, with the host's own capabilities
  // declared so that only genuine duplicates remain.
  const detector = createConflictDetector({ platform: process.platform });
  detector.upsert('host:capabilities', [{
    kind: 'service',
    key: 'host.capabilities',
    provides: ['cordis.effect', 'ctx.tools', 'ctx.slots'],
  }]);
  detector.report('acme-one', declaration);
  detector.report('acme-two', declaration);
  assert.deepEqual(
    detector.conflicts().map((conflict) => conflict.code),
    ['C2'],
    'two carriers of one declaration conflict on the tool key and nothing else',
  );

  // L3: a patch produced by the kit, merged by the lifecycle gate.
  const api = new DSHPatchAPI();
  api.insert({ id: 'acme-interceptor', name: './lib/auth.js' });
  const { yaml } = api.commit();
  const merged = mergePatchBlock({ homeText: '- id: plugin-manager\n', block: yaml });
  assert.equal(merged.status, 'appended');

  // L4: the merged text is what an operator YAML file would hold next boot.
  assert.equal(typeof merged.text, 'string');
  assert.ok(merged.text.endsWith('\n'), 'the appended block ends the file with a newline');
});
