/**
 * Tests for D1 layer attribution in profile-dump.
 *
 * The layer provenance a dump carries is text the *exporter* wrote: `# == <origin>` before a run
 * of rows, and `# == <origin>, patched by <layer>, <layer>` when a later layer changed a row in
 * that run. These tests pin three separate promises:
 *
 *   1. SHAPE — which run a row belongs to, how many rows each run holds, and what the attribution
 *      map says for a row that has an id.
 *   2. RESTRAINT — layer labels are operator text (usually a path), so they appear only when the
 *      caller asked for `discloseLayers`, and the id-keyed attribution map appears only when the
 *      caller asked for both disclosures. Neither flag unlocks the other's data.
 *   3. HONESTY — a row above every separator has no layer, a separator inside a block scalar is
 *      not a separator, and `lineNumber` is a line in the export, never a line inside a patch file.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROFILE_DUMP_EXIT,
  PROFILE_DUMP_LAYER_LIMITATIONS,
  PROFILE_DUMP_LIMITATIONS,
  PROFILE_DUMP_LIMITS,
  summarizeProfileDumpText,
} from '../src/profile-dump.js';

const CLI_PATH = fileURLToPath(new URL('../src/profile-dump-cli.js', import.meta.url));

/** A dump the exporter would write: one origin section, no patch. */
const ONE_LAYER = [
  '# == @fixture/bundle-a',
  '- id: alpha',
  '  name: ./plugins/alpha.js',
  '- id: beta',
  '  name: ./plugins/beta.js',
  '',
].join('\n');

/** Two sections, the second patched by an absolute path (as the exporter reports it). */
const TWO_LAYERS_PATCHED = [
  '# == @fixture/bundle-a',
  '- id: alpha',
  '  name: ./plugins/alpha.js',
  '# == cordis.yml, patched by /home/operator/private/profile.patch.yml',
  '- id: beta',
  '  name: ./plugins/beta.js',
  '',
].join('\n');

/** One row before any separator, one after: only the second has a layer. */
const ROW_BEFORE_SEPARATOR = [
  '- id: pre',
  '  name: ./plugins/pre.js',
  '# == @fixture/bundle-a',
  '- id: alpha',
  '  name: ./plugins/alpha.js',
  '',
].join('\n');

/** Run the summariser with the given options and return the summary plus its serialized form. */
function summarize(text, options = {}) {
  const result = summarizeProfileDumpText(text, options);
  return { ...result, json: JSON.stringify(result.summary) };
}

/** Assert that no member of `secrets` appears anywhere in the serialized summary. */
function assertSilent(json, secrets) {
  for (const secret of secrets) {
    assert.equal(
      json.includes(secret),
      false,
      `summary leaked ${JSON.stringify(secret)}: ${json.slice(0, 400)}`,
    );
  }
}

describe('layer separators, undisclosed', () => {
  test('layers are positional facts with no label', () => {
    const { summary } = summarize(ONE_LAYER);
    assert.equal(summary.layersDisclosed, false);
    assert.deepEqual(summary.layers, [
      { index: 1, line: 1, rowCount: 2, patchedCount: 0, origin: null, patchedBy: null },
    ]);
    assert.deepEqual(
      summary.rows.map((row) => [row.index, row.layer, row.patched]),
      [
        [1, 1, false],
        [2, 1, false],
      ],
    );
  });

  test('a patching layer is visible as a flag but its label is not', () => {
    const { summary, json } = summarize(TWO_LAYERS_PATCHED);
    assert.equal(summary.layers[1].patchedCount, 1);
    assert.equal(summary.rows[1].patched, true);
    assert.equal(summary.rows[0].patched, false);
    assertSilent(json, ['@fixture/bundle-a', 'cordis.yml', '/home/operator/private']);
  });

  test('no separators at all means no layers and no layer on any row', () => {
    const { summary } = summarize('- id: alpha\n  name: ./plugins/alpha.js\n');
    assert.deepEqual(summary.layers, []);
    assert.deepEqual(
      summary.rows.map((row) => [row.layer, row.patched]),
      [[null, false]],
    );
  });

  test('a row above every separator has no layer rather than a guessed one', () => {
    const { summary } = summarize(ROW_BEFORE_SEPARATOR);
    assert.equal(summary.rows[0].layer, null);
    assert.equal(summary.rows[1].layer, 1);
    assert.equal(summary.layers.length, 1);
  });
});

describe('layer labels, disclosed', () => {
  test('origin and patchedBy appear only when asked for', () => {
    const { summary } = summarize(TWO_LAYERS_PATCHED, { discloseLayers: true });
    assert.equal(summary.layersDisclosed, true);
    assert.deepEqual(summary.layers[0], {
      index: 1,
      line: 1,
      rowCount: 1,
      patchedCount: 0,
      origin: '@fixture/bundle-a',
      patchedBy: [],
    });
    assert.deepEqual(summary.layers[1], {
      index: 2,
      line: 4,
      rowCount: 1,
      patchedCount: 1,
      origin: 'cordis.yml',
      patchedBy: ['/home/operator/private/profile.patch.yml'],
    });
  });

  test('several patching layers keep their order', () => {
    const text = [
      '# == cordis.yml, patched by /a/first.patch.yml, /b/second.patch.yml',
      '- id: alpha',
      '',
    ].join('\n');
    const { summary } = summarize(text, { discloseLayers: true });
    assert.deepEqual(summary.layers[0].patchedBy, ['/a/first.patch.yml', '/b/second.patch.yml']);
  });

  test('an empty origin is unknown, not an empty label', () => {
    const { summary } = summarize('# == \n- id: alpha\n', { discloseLayers: true });
    assert.equal(summary.layers[0].origin, null);
  });
});

describe('attribution map', () => {
  test('is null unless both disclosures were requested', () => {
    assert.equal(summarize(TWO_LAYERS_PATCHED).summary.attribution, null);
    assert.equal(
      summarize(TWO_LAYERS_PATCHED, { discloseIdentity: true }).summary.attribution,
      null,
    );
    assert.equal(
      summarize(TWO_LAYERS_PATCHED, { discloseLayers: true }).summary.attribution,
      null,
    );
  });

  test('maps each row id to its layer, patch file and export line', () => {
    const { summary } = summarize(TWO_LAYERS_PATCHED, {
      discloseIdentity: true,
      discloseLayers: true,
    });
    assert.deepEqual(summary.attribution, {
      alpha: { layer: 1, patchFile: '@fixture/bundle-a', lineNumber: 2 },
      beta: {
        layer: 2,
        patchFile: '/home/operator/private/profile.patch.yml',
        lineNumber: 5,
      },
    });
  });

  test('omits rows without an id and rows above every separator', () => {
    const text = [
      '- id: pre',
      '  name: ./plugins/pre.js',
      '# == cordis.yml, patched by /p.patch.yml',
      '- name: ./plugins/anonymous.js',
      '- id: alpha',
      '',
    ].join('\n');
    const { summary } = summarize(text, { discloseIdentity: true, discloseLayers: true });
    assert.deepEqual(Object.keys(summary.attribution), ['alpha']);
    assert.deepEqual(summary.attribution.alpha, {
      layer: 1,
      patchFile: '/p.patch.yml',
      lineNumber: 5,
    });
  });

  test('an unpatched row names its origin file', () => {
    const { summary } = summarize(ONE_LAYER, { discloseIdentity: true, discloseLayers: true });
    assert.equal(summary.attribution.alpha.patchFile, '@fixture/bundle-a');
    assert.equal(summary.attribution.beta.layer, 1);
  });
});

describe('limits and limitations', () => {
  test('a layer counts every row, the display window still caps', () => {
    const entries = [];
    for (let index = 0; index < PROFILE_DUMP_LIMITS.maxRows + 6; index += 1) {
      entries.push(`- id: row-${index}`, `  name: ./plugins/row-${index}.js`);
    }
    const { summary } = summarize(['# == @fixture/bundle-a', ...entries, ''].join('\n'));
    assert.equal(summary.layers[0].rowCount, PROFILE_DUMP_LIMITS.maxRows + 6);
    assert.equal(summary.rows.length, PROFILE_DUMP_LIMITS.maxRows);
    assert.equal(summary.rowsTruncated, true);
  });

  test('layer limitations appear only with layer disclosure', () => {
    const off = summarize(TWO_LAYERS_PATCHED).summary;
    assert.deepEqual(off.limitations, [...PROFILE_DUMP_LIMITATIONS]);

    const on = summarize(TWO_LAYERS_PATCHED, { discloseLayers: true }).summary;
    assert.deepEqual(on.limitations, [
      ...PROFILE_DUMP_LIMITATIONS,
      ...PROFILE_DUMP_LAYER_LIMITATIONS,
    ]);
    assert.equal(on.limitations.includes('PATCH_FILE_LINE_UNKNOWN'), true);
  });

  test('the layer vocabulary is what this module promises and nothing more', () => {
    assert.deepEqual([...PROFILE_DUMP_LAYER_LIMITATIONS], [
      'LAYER_LABELS_ARE_OPERATOR_TEXT_AND_MAY_CARRY_PATHS',
      'LAYER_BOUNDARIES_COME_FROM_EXPORT_COMMENTS_NOT_FROM_PATCH_SEMANTICS',
      'PATCH_FILE_LINE_UNKNOWN',
      'PATCHED_FLAG_DOES_NOT_SAY_WHAT_CHANGED',
    ]);
  });
});

describe('options', () => {
  test('an unknown key is refused rather than ignored', () => {
    assert.throws(
      () => summarizeProfileDumpText(ONE_LAYER, { discloseLayer: true }),
      /profile-dump: options carry an unknown key/,
    );
  });

  test('a non-boolean flag is refused', () => {
    assert.throws(
      () => summarizeProfileDumpText(ONE_LAYER, { discloseLayers: 'yes' }),
      /profile-dump: discloseLayers must be a boolean/,
    );
  });
});

describe('separator detection', () => {
  test('an indented separator inside a block scalar does not split a layer', () => {
    const text = [
      '# == @fixture/bundle-a',
      '- id: alpha',
      '  config:',
      '    note: |',
      '      # == not/a/layer, patched by /fake.patch.yml',
      '- id: beta',
      '',
    ].join('\n');
    const { summary } = summarize(text, { discloseLayers: true });
    assert.equal(summary.layers.length, 1);
    assert.equal(summary.layers[0].rowCount, 2);
    assert.equal(summary.layers[0].patchedCount, 0);
    assert.equal(summary.rows[1].layer, 1);
  });

  test('provenance survives a refused document', () => {
    // A root mapping is not a dump; the document is refused, yet the separators it
    // displayed are still reported, because they were read before parsing gave up.
    const text = ['# == @fixture/bundle-a', 'not-a-sequence: 1', ''].join('\n');
    const { summary, ok } = summarize(text);
    assert.equal(ok, false);
    assert.equal(summary.inventory, 'none');
    assert.equal(summary.layers.length, 1);
    assert.equal(summary.layers[0].rowCount, 0);
  });
});

describe('the command line', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'profile-dump-layers-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  const fixture = join(scratch, 'dump.yml');
  writeFileSync(fixture, TWO_LAYERS_PATCHED);

  function run(args) {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      killSignal: 'SIGKILL',
    });
  }

  test('without flags the labels never reach stdout', () => {
    const result = run([fixture]);
    assert.equal(result.status, PROFILE_DUMP_EXIT.OK, result.stderr);
    assert.equal(result.stdout.includes('/home/operator/private'), false);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.layersDisclosed, false);
    assert.equal(parsed.rows[1].patched, true);
    assert.equal(parsed.attribution, null);
  });

  test('--disclose-layers alone discloses labels but not the id-keyed map', () => {
    const result = run(['--disclose-layers', fixture]);
    assert.equal(result.status, PROFILE_DUMP_EXIT.OK, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.layersDisclosed, true);
    assert.deepEqual(parsed.layers[1].patchedBy, ['/home/operator/private/profile.patch.yml']);
    assert.equal(parsed.attribution, null);
    assert.equal(parsed.identityDisclosed, false);
  });

  test('both flags produce the attribution map', () => {
    const result = run(['--disclose-identity', '--disclose-layers', fixture]);
    assert.equal(result.status, PROFILE_DUMP_EXIT.OK, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed.attribution), ['alpha', 'beta']);
  });

  test('a repeated --disclose-layers is a usage error', () => {
    const result = run(['--disclose-layers', '--disclose-layers', fixture]);
    assert.equal(result.status, PROFILE_DUMP_EXIT.USAGE);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'USAGE');
  });

  test('the flags are accepted in either order', () => {
    const result = run([fixture, '--disclose-layers', '--disclose-identity']);
    assert.equal(result.status, PROFILE_DUMP_EXIT.OK, result.stderr);
    assert.equal(JSON.parse(result.stdout).attribution !== null, true);
  });
});
