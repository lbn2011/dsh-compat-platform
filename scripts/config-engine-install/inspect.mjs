// PREPARED NOT EXECUTED. Validates metadata only; never imports dependencies.
import { readFileSync } from 'node:fs';
const [mode, path] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
const doc = JSON.parse(readFileSync(path, 'utf8'));
const expected = { '@hyperjump/browser': '1.6.0', '@hyperjump/json-schema': '1.18.0' };
const depsMatch = (value) => value && Object.keys(value).length === 2 &&
  Object.entries(expected).every(([name, version]) => value[name] === version);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 9)) fail('Node >=24.9.0 required');
if (mode === 'manifest') {
  if (doc.name !== '@dsh-compat/config-check' || doc.private !== true || doc.type !== 'module' ||
      doc.engines?.node !== '>=24.9.0' || !depsMatch(doc.dependencies)) fail('manifest contract mismatch');
  for (const key of ['scripts', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'workspaces', 'overrides']) {
    if (key in doc) fail(`unexpected manifest field: ${key}`);
  }
  console.log(JSON.stringify({ mode, manifest: doc }, null, 2));
} else if (mode === 'lock') {
  if (doc.lockfileVersion !== 3 || doc.name !== '@dsh-compat/config-check' || !doc.packages ||
      !depsMatch(doc.packages['']?.dependencies)) fail('lock contract mismatch');
  const inventory = [];
  for (const [location, entry] of Object.entries(doc.packages)) {
    if (location === '') continue;
    if (!location.startsWith('node_modules/') || location.includes('..') || location.includes('\\') || entry.link) {
      fail(`non-registry location: ${location}`);
    }
    if (typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.version)) {
      fail(`missing exact version: ${location}`);
    }
    const url = new URL(entry.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.hash || url.search) {
      fail(`unapproved resolved URL: ${location}`);
    }
    // Exactly one SHA-512 digest: canonical padded base64 of exactly 64 bytes.
    // Buffer decoding alone is permissive; round-trip equality rejects alternate
    // encodings (including nonzero pad bits), whitespace and omitted padding.
    if (typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) {
      fail(`invalid sha512 integrity encoding: ${location}`);
    }
    const encodedDigest = entry.integrity.slice('sha512-'.length);
    const digest = Buffer.from(encodedDigest, 'base64');
    if (digest.length !== 64 || digest.toString('base64') !== encodedDigest) {
      fail(`noncanonical or wrong-length sha512 integrity: ${location}`);
    }
    inventory.push({ location, ...entry });
  }
  for (const [name, version] of Object.entries(expected)) {
    if (doc.packages[`node_modules/${name}`]?.version !== version) fail(`direct pin mismatch: ${name}`);
  }
  console.log(JSON.stringify({ mode, lockfileVersion: 3, packages: inventory,
    reviewRequired: true, transitivePinReviewed: false }, null, 2));
} else fail('unknown inspection mode');
