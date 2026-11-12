/**
 * Reads a package's `dsh.lifecycle.postInstall` declaration into a runnable plan.
 *
 * This module is pure: it receives an already-parsed `package.json` value and a
 * package directory, and returns either a plan or a closed set of issues. It
 * never touches the filesystem, so "the script exists" and "the script is safe
 * to run" are NOT established here — see {@link LIFECYCLE_LIMITATIONS}.
 *
 * The declaration is deliberately narrow. A lifecycle entry names a JavaScript
 * file INSIDE the package; it is never a shell string, never an absolute path,
 * and never a command looked up on PATH. Anything else is refused rather than
 * interpreted, because the only alternative would be guessing what an operator
 * meant by "run this".
 *
 * @module dsh-compat-lifecycle-bootstrap/lifecycle-manifest
 */

import { isAbsolute, resolve, sep } from 'node:path';

export const LIFECYCLE_MANIFEST_VERSION = 'lifecycle-manifest/0.1-draft.1';

/** The only lifecycle key this version understands. */
export const LIFECYCLE_KEYS = Object.freeze(['postInstall']);

/** The only postInstall members this version understands. */
export const POST_INSTALL_KEYS = Object.freeze(['script', 'args', 'timeoutMs']);

/** Script extensions that are run by the Node binary we are already in. */
export const SCRIPT_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

export const LIFECYCLE_LIMITS = Object.freeze({
  maxArgs: 16,
  maxArgLength: 512,
  minTimeoutMs: 100,
  maxTimeoutMs: 600000,
  defaultTimeoutMs: 60000,
  maxOutputBytes: 65536,
});

/**
 * Closed vocabulary of refusal codes. A plan is produced only when the issues
 * list is empty; a partially readable declaration is refused whole, because
 * running the readable half of an operator's intent is a guess.
 */
export const LIFECYCLE_CODES = Object.freeze([
  'PKG_NOT_OBJECT',
  'DSH_NOT_OBJECT',
  'LIFECYCLE_NOT_OBJECT',
  'LIFECYCLE_UNKNOWN_KEY',
  'POST_INSTALL_NOT_STRING_OR_OBJECT',
  'POST_INSTALL_UNKNOWN_KEY',
  'SCRIPT_MISSING',
  'SCRIPT_NOT_STRING',
  'SCRIPT_EMPTY',
  'SCRIPT_ABSOLUTE',
  'SCRIPT_OUTSIDE_PACKAGE',
  'SCRIPT_EXTENSION_UNSUPPORTED',
  'SCRIPT_RESOLVES_TO_PACKAGE_ROOT',
  'ARGS_NOT_ARRAY',
  'ARGS_TOO_MANY',
  'ARG_NOT_STRING',
  'ARG_TOO_LONG',
  'TIMEOUT_NOT_NUMBER',
  'TIMEOUT_OUT_OF_RANGE',
]);

/**
 * What the plan does NOT establish. Every one of these is a real gap, not a
 * disclaimer: the runner bounds time and output, but it cannot bound what the
 * child process is allowed to do.
 */
export const LIFECYCLE_LIMITATIONS = Object.freeze([
  'SCRIPT_CONTENT_IS_NOT_INSPECTED_OR_TRUSTED',
  'SCRIPT_RUNS_WITH_THE_HOST_PROCESS_PRIVILEGES',
  'NO_FILESYSTEM_OR_NETWORK_SANDBOX_IS_APPLIED',
  'SCRIPT_EXISTENCE_IS_NOT_CHECKED_AT_PLAN_TIME',
  'DECLARATION_IS_AUTHORED_BY_THE_INSTALLED_PACKAGE',
]);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/**
 * Resolve a declared script path against the package directory and prove it
 * stays inside that directory.
 *
 * @param {string} packageDir absolute package directory
 * @param {string} script declared path
 * @returns {{ok: true, path: string} | {ok: false, code: string}}
 */
export function resolveScriptPath(packageDir, script) {
  if (isAbsolute(script)) return { ok: false, code: 'SCRIPT_ABSOLUTE' };
  const root = resolve(packageDir);
  const target = resolve(root, script);
  if (target !== root && !target.startsWith(root + sep)) {
    return { ok: false, code: 'SCRIPT_OUTSIDE_PACKAGE' };
  }
  if (target === root) return { ok: false, code: 'SCRIPT_RESOLVES_TO_PACKAGE_ROOT' };
  const dot = target.lastIndexOf('.');
  const extension = dot === -1 ? '' : target.slice(dot).toLowerCase();
  if (!SCRIPT_EXTENSIONS.includes(extension)) {
    return { ok: false, code: 'SCRIPT_EXTENSION_UNSUPPORTED' };
  }
  return { ok: true, path: target };
}

/**
 * Read one package manifest's lifecycle declaration.
 *
 * @param {unknown} pkgJson parsed package.json value
 * @param {{packageDir: string}} options package directory used for containment
 * @returns {{plan: object|null, issues: string[], limitations: string[]}}
 *   `plan` is `{scriptPath, args, timeoutMs, declaration}` when `issues` is empty.
 */
export function readLifecyclePlan(pkgJson, options) {
  if (!isPlainObject(options) || typeof options.packageDir !== 'string') {
    throw new TypeError('lifecycle-manifest: options must carry a string packageDir');
  }
  const issues = [];
  const push = (code) => {
    if (!issues.includes(code)) issues.push(code);
  };

  if (!isPlainObject(pkgJson)) {
    push('PKG_NOT_OBJECT');
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }
  const dsh = pkgJson.dsh;
  if (dsh === undefined) {
    // A package with no dsh block simply has no lifecycle; this is not a defect.
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }
  if (!isPlainObject(dsh)) {
    push('DSH_NOT_OBJECT');
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }
  const lifecycle = dsh.lifecycle;
  if (lifecycle === undefined) {
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }
  if (!isPlainObject(lifecycle)) {
    push('LIFECYCLE_NOT_OBJECT');
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }
  for (const key of Object.keys(lifecycle)) {
    if (!LIFECYCLE_KEYS.includes(key)) push('LIFECYCLE_UNKNOWN_KEY');
  }

  const declared = lifecycle.postInstall;
  if (declared === undefined) {
    return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
  }

  let script = null;
  let args = [];
  let timeoutMs = LIFECYCLE_LIMITS.defaultTimeoutMs;

  if (typeof declared === 'string') {
    script = declared;
  } else if (isPlainObject(declared)) {
    for (const key of Object.keys(declared)) {
      if (!POST_INSTALL_KEYS.includes(key)) push('POST_INSTALL_UNKNOWN_KEY');
    }
    if (declared.script === undefined) push('SCRIPT_MISSING');
    else if (typeof declared.script !== 'string') push('SCRIPT_NOT_STRING');
    else script = declared.script;

    if (declared.args !== undefined) {
      if (!Array.isArray(declared.args)) push('ARGS_NOT_ARRAY');
      else if (declared.args.length > LIFECYCLE_LIMITS.maxArgs) push('ARGS_TOO_MANY');
      else {
        for (const arg of declared.args) {
          if (typeof arg !== 'string') {
            push('ARG_NOT_STRING');
            break;
          }
          if (arg.length > LIFECYCLE_LIMITS.maxArgLength) {
            push('ARG_TOO_LONG');
            break;
          }
        }
        if (issues.length === 0) args = [...declared.args];
      }
    }

    if (declared.timeoutMs !== undefined) {
      const value = declared.timeoutMs;
      if (typeof value !== 'number' || !Number.isFinite(value)) push('TIMEOUT_NOT_NUMBER');
      else if (value < LIFECYCLE_LIMITS.minTimeoutMs || value > LIFECYCLE_LIMITS.maxTimeoutMs) {
        push('TIMEOUT_OUT_OF_RANGE');
      } else timeoutMs = value;
    }
  } else {
    push('POST_INSTALL_NOT_STRING_OR_OBJECT');
  }

  if (script !== null) {
    if (script.length === 0) push('SCRIPT_EMPTY');
    else {
      const resolved = resolveScriptPath(options.packageDir, script);
      if (!resolved.ok) push(resolved.code);
      else {
        return {
          plan: Object.freeze({
            script: script,
            scriptPath: resolved.path,
            args: Object.freeze(args),
            timeoutMs,
            declaration: declared,
          }),
          issues,
          limitations: [...LIFECYCLE_LIMITATIONS],
        };
      }
    }
  }

  return { plan: null, issues, limitations: [...LIFECYCLE_LIMITATIONS] };
}

/**
 * A stable identity for one declared lifecycle run, used to skip a second run
 * for the same package content. Change the script path, the args, or the
 * declaration and the identity changes with it.
 *
 * @param {{scriptPath: string, args: readonly string[], timeoutMs: number}} plan
 * @returns {string}
 */
export function lifecyclePlanKey(plan) {
  return [plan.scriptPath, plan.timeoutMs, ...plan.args].join('\u0000');
}
