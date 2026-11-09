#!/usr/bin/env node
// CLI for the configuration checker.
//
//   config-check <schema.json> <instance.json> [--entry-label <word>]
//   config-check --declaration <declaration.json> <instance.json> [--entry-label <word>]
//
// Reads two JSON files, judges the instance against the schema, prints one JSON
// summary on stdout. No configuration value is ever printed; findings carry a
// key path, a keyword word and a summary of what the schema allowed.
//
// Exit codes: 0 valid, 1 invalid, 2 not checked / refused, 5 internal, 64 usage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkConfiguration,
  configCheckExitCode,
  schemaFromDeclaration,
  selectContract,
  CONFIG_CHECK_EXIT,
  CONFIG_CHECK_REFUSALS,
} from '../src/config-check.js';
import { createEngine } from '../src/hyperjump-engine.js';

const USAGE =
  'usage: config-check <schema.json> <instance.json> [--entry-label <word>]\n' +
  '       config-check --declaration <declaration.json> <instance.json> [--entry-label <word>]';

const ENGINE_SPECIFIER = '@hyperjump/json-schema/draft-2020-12';

// The engine is not a dependency of this repository (it is acquired into a
// disposable artifact directory), so the caller may name the tree that holds it.
// CONFIG_CHECK_ENGINE_ROOT is that tree's `node_modules` directory.
function loaderFor(root) {
  if (typeof root !== 'string' || root === '') return (specifier) => import(specifier);
  return (specifier) => import(pathToFileURL(join(root, specifier, 'index.js')).href);
}

function writeOnce(stream, text) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      stream.off('error', onError);
      resolve(ok);
    };
    const onError = () => settle(false);
    stream.once('error', onError);
    try {
      stream.write(text, (error) => settle(error == null));
    } catch {
      settle(false);
    }
  });
}

function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { error: `${what} file could not be read` };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${what} file is not JSON` };
  }
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = argv.slice(2);

  let entryLabel = null;
  let declarationPath = null;
  let correspondencePath = null;
  let entryId = '';
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--entry-label') {
      entryLabel = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--correspondence') {
      correspondencePath = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--entry-id') {
      entryId = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--declaration') {
      declarationPath = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      await writeOnce(stderr, `${USAGE}\nunknown option: ${arg}\n`);
      return CONFIG_CHECK_EXIT.USAGE;
    }
    positional.push(arg);
  }
  // In declaration mode the schema comes from the declaration, so only the
  // instance is positional. Requiring two positionals there made every
  // declaration-mode invocation exit 64 with usage, which is how this was found.
  const expectedPositionals = declarationPath === null ? 2 : 1;
  if (positional.length !== expectedPositionals || entryLabel === '' || declarationPath === '') {
    const written = await writeOnce(stderr, `${USAGE}\n`);
    return written ? CONFIG_CHECK_EXIT.USAGE : CONFIG_CHECK_EXIT.INTERNAL;
  }

  const [schemaArg, instanceArg] = declarationPath === null ? positional : [null, positional[0]];
  let schemaValue;
  if (declarationPath !== null) {
    const declarationRead = readJson(declarationPath, 'declaration');
    if (declarationRead.error !== undefined) {
      await writeOnce(stderr, `config-check: ${declarationRead.error}\n`);
      return CONFIG_CHECK_EXIT.USAGE;
    }
    let validateDeclaration;
    try {
      const specRoot = io.specRoot ?? process.env.CONFIG_CHECK_SPEC_ROOT;
      const specifier = specRoot ? pathToFileURL(join(specRoot, 'src/index.js')).href : 'dsh-compat-spec';
      ({ validateDeclaration } = await import(specifier));
    } catch {
      await writeOnce(stderr, 'config-check: the spec grammar could not be loaded\n');
      return CONFIG_CHECK_EXIT.INTERNAL;
    }
    let extracted;
    if (correspondencePath !== null) {
      if (entryId === '') {
        await writeOnce(stderr, `${USAGE}\n--correspondence requires --entry-id\n`);
        return CONFIG_CHECK_EXIT.USAGE;
      }
      const correspondenceRead = readJson(correspondencePath, 'correspondence');
      if (correspondenceRead.error !== undefined) {
        await writeOnce(stderr, `config-check: ${correspondenceRead.error}\n`);
        return CONFIG_CHECK_EXIT.USAGE;
      }
      extracted = selectContract({
        correspondence: correspondenceRead.value,
        entryId,
        declaration: declarationRead.value,
        validateDeclaration,
      });
      if (extracted.ok) entryLabel = extracted.entryLabel;
    } else {
      extracted = schemaFromDeclaration(declarationRead.value, { validateDeclaration });
    }
    if (extracted.ok === false && !Object.values(CONFIG_CHECK_REFUSALS).includes(extracted.refusal)) {
      extracted = { ok: false, refusal: CONFIG_CHECK_REFUSALS.CORRESPONDENCE_INVALID };
    }
    if (!extracted.ok) {
      const writtenRefusal = await writeOnce(
        stdout,
        `${JSON.stringify(
          { configCheckSummary: 'config-check-summary/0.1-draft.1', entryLabel, schemaStatus: 'refused', refusal: extracted.refusal, findings: [], counts: { checked: 0, invalid: 0, findings: 0, findingsTruncated: false }, certification: false },
          null,
          2,
        )}\n`,
      );
      return writtenRefusal ? CONFIG_CHECK_EXIT.NOT_CHECKED : CONFIG_CHECK_EXIT.INTERNAL;
    }
    schemaValue = extracted.schema;
  } else {
    const schemaRead = readJson(schemaArg, 'schema');
    if (schemaRead.error !== undefined) {
      await writeOnce(stderr, `config-check: ${schemaRead.error}\n`);
      return CONFIG_CHECK_EXIT.USAGE;
    }
    schemaValue = schemaRead.value;
  }
  const instanceRead = readJson(instanceArg, 'instance');
  if (instanceRead.error !== undefined) {
    await writeOnce(stderr, `config-check: ${instanceRead.error}\n`);
    return CONFIG_CHECK_EXIT.USAGE;
  }

  let engine;
  try {
    engine = await createEngine({
      specifier: ENGINE_SPECIFIER,
      loadModule: loaderFor(io.engineRoot ?? process.env.CONFIG_CHECK_ENGINE_ROOT),
    });
  } catch {
    await writeOnce(stderr, 'config-check: the JSON Schema engine could not be loaded\n');
    return CONFIG_CHECK_EXIT.INTERNAL;
  }

  let result;
  try {
    result = await checkConfiguration({
      schema: schemaValue,
      instance: instanceRead.value,
      engine,
      entryLabel,
    });
  } catch {
    await writeOnce(stderr, 'config-check: internal failure\n');
    return CONFIG_CHECK_EXIT.INTERNAL;
  }

  const written = await writeOnce(stdout, `${JSON.stringify(result, null, 2)}\n`);
  if (!written) return CONFIG_CHECK_EXIT.INTERNAL;
  return configCheckExitCode(result);
}

const invoked = process.argv[1];
if (typeof invoked === 'string' && invoked.endsWith('config-check-cli.js')) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = CONFIG_CHECK_EXIT.INTERNAL;
    },
  );
}
