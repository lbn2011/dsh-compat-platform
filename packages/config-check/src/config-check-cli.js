#!/usr/bin/env node
// CLI for the configuration checker.
//
//   config-check <schema.json> <instance.json> [--entry-label <word>]
//
// Reads two JSON files, judges the instance against the schema, prints one JSON
// summary on stdout. No configuration value is ever printed; findings carry a
// key path, a keyword word and a summary of what the schema allowed.
//
// Exit codes: 0 valid, 1 invalid, 2 not checked / refused, 5 internal, 64 usage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkConfiguration, configCheckExitCode, CONFIG_CHECK_EXIT } from '../src/config-check.js';
import { createEngine } from '../src/hyperjump-engine.js';

const USAGE = 'usage: config-check <schema.json> <instance.json> [--entry-label <word>]';

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
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--entry-label') {
      entryLabel = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      await writeOnce(stderr, `${USAGE}\nunknown option: ${arg}\n`);
      return CONFIG_CHECK_EXIT.USAGE;
    }
    positional.push(arg);
  }
  if (positional.length !== 2 || entryLabel === '') {
    const written = await writeOnce(stderr, `${USAGE}\n`);
    return written ? CONFIG_CHECK_EXIT.USAGE : CONFIG_CHECK_EXIT.INTERNAL;
  }

  const [schemaArg, instanceArg] = positional;
  const schemaRead = readJson(schemaArg, 'schema');
  if (schemaRead.error !== undefined) {
    await writeOnce(stderr, `config-check: ${schemaRead.error}\n`);
    return CONFIG_CHECK_EXIT.USAGE;
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
      schema: schemaRead.value,
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
