#!/usr/bin/env node
/**
 * dsh-compat-platform CLI — deterministic static declaration analysis.
 *
 * TRUST BOUNDARY, stated once and enforced by construction:
 *
 *   1. This CLI NEVER imports, requires, evaluates or otherwise executes the
 *      plugins being analyzed. It reads JSON text and reasons over that text.
 *   2. The ONLY code it executes besides its own modules is the validator you
 *      name explicitly with `--validator <path>`. That import() runs whatever
 *      JavaScript that file contains, with this process's privileges. You must
 *      only point it at code you trust — normally the released
 *      `dsh-compat-spec` package (see the README for exact invocations).
 *   3. It never reads the DSH profile, never scans the host, never starts a
 *      server, never installs anything and never writes a file.
 *
 * Usage:
 *   dsh-compat-analyze --validator <path> [--export <name>] [--capability <name>...] <manifest.json|-> 
 *
 * Exit codes: 0 clean, 1 error findings, 2 manifest unreadable, 3 usage or
 * validator-load failure, 4 validator threw, 5 internal failure.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyze } from './analyze.js';
import { EXIT_CODES } from './exit-codes.js';
import { formatReportJson, exitCodeFor } from './report.js';

const USAGE = `dsh-compat-analyze — deterministic static declaration analysis

TRUST BOUNDARY: this CLI never executes the analyzed plugins. The only outside
code it runs is the validator you name with --validator, imported into this
process with your privileges. Point it only at trusted code.

Usage:
  dsh-compat-analyze --validator <path> [--export <name>] [--capability <name>]... <manifest.json|->

Required:
  --validator <path>   Explicit ESM file that exports a declaration validator.
                       IMPORTANT: this path is imported and executed in this
                       process. Use only code you trust (e.g. dsh-compat-spec).
  --export <name>      Exported binding to use as the validator. May be a
                       dotted path (default: validateDeclaration).

Optional:
  --capability <name>  Caller-declared available capability name. Repeat for each
                       name. This is only a convenience for manifests that omit
                       "availableCapabilities"; supplying both is a usage error.
  --help               Print this help to stderr and exit 0.

Input:
  manifest.json        JSON with {"declarations": [...], "availableCapabilities": [...]}
                       "availableCapabilities" is REQUIRED and must be an array of
                       non-empty, already-trimmed strings. Pass [] to declare that
                       none are available: every required capability is then
                       reported as MISSING_CAPABILITY. There is no "unknown"
                       availability state, and an omitted field is refused.
  -                    Read the manifest from standard input.

Declarations are passed to the validator verbatim: no {"value": ...} wrapper and
no caller-supplied index are recognized at this layer.

Output:
  A deterministic JSON report on stdout. Diagnostics go to stderr only.

Exit codes:
  0 no error-severity finding      2 manifest is not a JSON document
  1 error-severity findings        3 usage / validator could not be loaded
                                   4 the validator threw (analysis failed closed)
                                   5 internal failure
`;

function fail(message, code = EXIT_CODES.USAGE) {
  process.stderr.write(`dsh-compat-analyze: ${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { validator: null, exportName: 'validateDeclaration', capabilities: [], manifest: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (flag) => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
      }
      index += 1;
      return value;
    };

    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--validator') {
      options.validator = readValue('--validator');
    } else if (argument === '--export') {
      options.exportName = readValue('--export');
    } else if (argument === '--capability') {
      options.capabilities.push(readValue('--capability'));
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option ${JSON.stringify(argument)}.`);
    } else if (options.manifest === null) {
      options.manifest = argument;
    } else {
      throw new Error(`unexpected extra argument ${JSON.stringify(argument)}; exactly one manifest is accepted.`);
    }
  }

  return options;
}

/**
 * Resolve the validator. `./`, `../`, an absolute path or a `file:` URL is
 * loaded as a file; any other specifier is a bare module specifier and is
 * resolved by Node's normal resolution (normally a package from node_modules).
 */
async function loadValidator(specifier, exportName) {
  const isPathLike =
    isAbsolute(specifier) ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('file:');

  const target = isPathLike
    ? pathToFileURL(isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier)).href
    : specifier;

  const module = await import(target);

  let candidate = module;
  for (const segment of exportName.split('.')) {
    if (candidate === null || candidate === undefined) break;
    candidate = candidate[segment];
  }
  if (typeof candidate !== 'function') {
    const exported = Object.keys(module).sort().join(', ') || '<none>';
    throw new Error(
      `module ${JSON.stringify(specifier)} does not export "${exportName}" as a function (exports: ${exported}).`,
    );
  }
  return candidate;
}

function readManifest(path) {
  const text =
    path === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(resolve(process.cwd(), path), 'utf8');
  if (text.codePointAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    fail(describeError(error));
    process.stderr.write(USAGE);
    return;
  }

  if (options.help) {
    process.stderr.write(USAGE);
    process.exitCode = EXIT_CODES.OK;
    return;
  }
  if (options.validator === null) {
    fail('--validator <path> is required. The validator is not imported implicitly.');
    process.stderr.write(USAGE);
    return;
  }
  if (options.manifest === null) {
    fail('a manifest path (or "-" for stdin) is required.');
    process.stderr.write(USAGE);
    return;
  }

  let text;
  try {
    text = readManifest(options.manifest);
  } catch (error) {
    fail(`cannot read manifest: ${describeError(error)}`, EXIT_CODES.MANIFEST_INVALID);
    return;
  }

  let input;
  try {
    input = JSON.parse(text);
  } catch (error) {
    // The raw JSON parser message never echoes file content beyond the
    // offending fragment, and no code from the document is executed.
    fail(`manifest is not valid JSON: ${describeError(error)}`, EXIT_CODES.MANIFEST_INVALID);
    return;
  }

  let validateDeclaration;
  try {
    validateDeclaration = await loadValidator(options.validator, options.exportName);
  } catch (error) {
    fail(
      `cannot load validator ${JSON.stringify(options.validator)}: ${describeError(error)}\n` +
        'The validator path is executed by this process; only point it at trusted code.',
      EXIT_CODES.USAGE,
    );
    return;
  }

  // The input envelope is exactly { declarations, availableCapabilities }.
  // `--capability` names form the caller-declared available set; the CLI never
  // invents availability, and a manifest that omits the field is refused by
  // analyze()'s TypeError rather than being read as "unknown".
  const envelope = input;
  if (options.capabilities.length > 0) {
    if (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Object.hasOwn(input, 'availableCapabilities')
    ) {
      fail(
        'the manifest already declares availableCapabilities; do not also pass --capability (exactly one availability source is accepted).',
        EXIT_CODES.USAGE,
      );
      return;
    }
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      envelope.availableCapabilities = [...options.capabilities];
    }
  }

  let report;
  try {
    report = analyze(envelope, { validateDeclaration });
  } catch (error) {
    if (error && error.code === 'ANALYZER_VALIDATOR_THREW') {
      fail(`analysis failed closed: ${describeError(error)}`, EXIT_CODES.VALIDATOR_FAILED);
      return;
    }
    // A malformed *envelope* is the caller's own document being wrong, so it is
    // reported as a manifest problem (exit 2), not as an internal failure.
    fail(`manifest does not match the analysis input contract: ${describeError(error)}`, EXIT_CODES.MANIFEST_INVALID);
    return;
  }

  process.stdout.write(formatReportJson(report));
  process.exitCode = exitCodeFor(report);
}

await main(process.argv.slice(2));
