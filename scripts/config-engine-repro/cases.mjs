// Preparation only: no runner, patch, dependency installation, or execution approval.
import { createRequire } from 'node:module';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const ROOT = 'https://repro.invalid/root';
const UNKNOWN = 'https://repro.invalid/unknown-dialect';
const EMBEDDED = 'https://repro.invalid/embedded';
const definitions = new Map();
function define(id, schema, instance, expected, control = false) {
  definitions.set(id, { schema: { $schema: DIALECT, ...schema }, instance, expected, control });
}
for (const keyword of ['const', 'enum']) {
  for (const [label, literal] of [
    ['anchor', { $anchor: 'literal' }],
    ['id', { $id: 'https://repro.invalid/literal' }],
    ['schema-known', { $schema: DIALECT }],
    ['schema-unknown', { $schema: UNKNOWN }]
  ]) {
    const schema = { [keyword]: keyword === 'enum' ? [literal] : literal };
    define(`${keyword}-${label}-equal`, schema, structuredClone(literal), true);
    define(`${keyword}-${label}-different`, schema, {}, false);
  }
}
define('scalar-equal', { const: 7 }, 7, true, true);
define('scalar-different', { const: 7 }, 8, false, true);
define('default-schema-unknown', { default: { $schema: UNKNOWN } }, null, true);
define('examples-schema-unknown', { examples: [{ $schema: UNKNOWN }] }, null, true);
const dynamicSchema = {
  $defs: { embedded: { $id: EMBEDDED, $dynamicAnchor: 'node', type: 'integer' } },
  $dynamicRef: `${EMBEDDED}#node`
};
define('dynamic-uri-integer', dynamicSchema, 7, true, true);
define('dynamic-uri-string', dynamicSchema, 'not-an-integer', false, true);
export const caseIds = Object.freeze([...definitions.keys()]);
let used = false;

function within(parent, child) {
  const suffix = relative(parent, child);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}
function requireCondition(condition) {
  if (!condition) throw new Error('PROBE_GUARD');
}

async function dependencyEntries(base) {
  requireCondition(isAbsolute(base));
  const canonicalBase = await realpath(base);
  requireCondition((await stat(canonicalBase)).isDirectory());
  const resolver = createRequire(join(canonicalBase, '__probe_resolver__.cjs'));
  async function checked(name, version, specifier, entrySuffix) {
    // Only fixed published package names/entry points; never import a caller fixture.
    const root = await realpath(join(canonicalBase, 'node_modules', name));
    requireCondition(within(canonicalBase, root));
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    requireCondition(manifest.name === name && manifest.version === version && manifest.type === 'module');
    const entry = await realpath(resolver.resolve(specifier));
    requireCondition(entry === join(root, ...entrySuffix));
    return entry;
  }
  const schema = await checked('@hyperjump/json-schema', '1.18.0',
    '@hyperjump/json-schema/draft-2020-12', ['draft-2020-12', 'index.js']);
  const browser = await checked('@hyperjump/browser', '1.6.0',
    '@hyperjump/browser', ['lib', 'index.js']);
  // Scheme removal must affect the very browser instance the validator imports.
  requireCondition(await realpath(createRequire(schema).resolve('@hyperjump/browser')) === browser);
  return { schema, browser, canonicalBase };
}

async function outputTarget(output, base) {
  requireCondition(isAbsolute(output));
  const parent = await realpath(dirname(output));
  const target = join(parent, relative(dirname(output), output));
  const checkout = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
  requireCondition(!within(checkout, target) && !within(base, target));
  return target;
}

/** Exactly one closed case per fresh process. Returns an exit code; no raw errors escape. */
export async function main(argv) {
  if (used) return 64;
  used = true;
  let target;
  let report;
  let code = 70;
  const id = Array.isArray(argv) && argv.length === 3 && definitions.has(argv[1]) ? argv[1] : null;
  if (id === null) {
    process.stdout.write('{"error":"ARGUMENT_ERROR"}\n');
    return 64;
  }
  const fixture = definitions.get(id);
  try {
    const entries = await dependencyEntries(argv[0]);
    target = await outputTarget(argv[2], entries.canonicalBase);
    const browser = await import(pathToFileURL(entries.browser).href);
    for (const scheme of ['http', 'https', 'file']) browser.removeUriSchemePlugin(scheme);
    const engine = await import(pathToFileURL(entries.schema).href);
    // Reassert after dialect initialization, before registering any probe schema.
    for (const scheme of ['http', 'https', 'file']) browser.removeUriSchemePlugin(scheme);
    let actual;
    let stage = 'REGISTER_ERROR';
    try {
      engine.registerSchema(structuredClone(fixture.schema), ROOT);
      stage = 'COMPILE_ERROR';
      const validator = await engine.validate(ROOT);
      stage = 'VALIDATE_ERROR';
      const result = await validator(structuredClone(fixture.instance));
      if (typeof result?.valid !== 'boolean') actual = { error: 'RESULT_SHAPE_ERROR' };
      else actual = { valid: result.valid };
    } catch {
      actual = { error: stage };
    }
    const mismatch = actual.valid !== fixture.expected;
    report = {
      case: id, expected: { valid: fixture.expected }, actual,
      status: mismatch ? (fixture.control ? 'control-mismatch' : 'reproduced') : 'not-reproduced'
    };
    code = mismatch ? 2 : 0;
  } catch {
    report = { case: id, expected: { valid: fixture.expected }, actual: { error: 'SETUP_ERROR' }, status: 'not-evaluated' };
  }
  if (!target) {
    process.stdout.write('{"error":"SETUP_ERROR"}\n');
    return 70;
  }
  try {
    const text = `${JSON.stringify(report)}\n`;
    requireCondition(Buffer.byteLength(text) <= 1024);
    // Refuse overwrites and existing symlinks; parent must be a trusted run-owned directory.
    await writeFile(target, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    process.stdout.write('{"error":"OUTPUT_ERROR"}\n');
    return 74;
  }
  return code;
}

// Importing this file builds fixed fixtures only; it does not import dependencies or run cases.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch {
    process.stdout.write('{"error":"INTERNAL_ERROR"}\n');
    process.exitCode = 70;
  }
}
