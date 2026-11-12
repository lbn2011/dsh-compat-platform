/**
 * Host entry for the lifecycle bootstrap plugin.
 *
 * This package is an ordinary DSH host plugin: one `apply()` that publishes one
 * service. It exists because installing a plugin that ships a build step leaves
 * the operator to run that step by hand, and because a bundle that ships a patch
 * block has to be merged into the profile before it takes effect.
 *
 * @module dsh-compat-lifecycle-bootstrap
 */

import {
  BOOTSTRAP_LIMITATIONS,
  DEFAULT_BUNDLE_PATCH_PATH,
  LIFECYCLE_BOOTSTRAP_VERSION,
  LIFECYCLE_EVENTS,
  LIFECYCLE_SIGNALS,
  createLifecycleBootstrap,
} from './lifecycle-bootstrap.js';

/** Cordis plugin name; also the key a host uses to enable or disable us. */
export const name = 'dsh-compat-lifecycle-bootstrap';

/** Required services. `pluginManager` is what makes "new package" observable. */
export const inject = ['pluginManager'];

const CONFIG_KEYS = Object.freeze([
  'forwardToHostLog',
  'mergePatches',
  'dshHome',
  'bundlePatchPath',
  'maxOutputBytes',
]);

const isPlainRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate the plugin config. Refusing an unknown key is deliberate: a
 * misspelled `forwardToHostLog` would otherwise silently keep forwarding.
 *
 * @param {unknown} config
 * @returns {object} options for {@link createLifecycleBootstrap}
 */
export function readOptions(config) {
  const input = config === undefined ? {} : config;
  if (!isPlainRecord(input)) {
    throw new TypeError('lifecycle-bootstrap: config must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new TypeError(`lifecycle-bootstrap: config carries an unknown key: ${key}`);
    }
  }
  const options = {};
  if (input.forwardToHostLog !== undefined) {
    if (typeof input.forwardToHostLog !== 'boolean') {
      throw new TypeError('lifecycle-bootstrap: forwardToHostLog must be a boolean');
    }
    // The service option is phrased positively; the config key is phrased as the
    // user-facing choice ("do you also want this in the install log?").
    options.emitInstallLog = input.forwardToHostLog;
  } else {
    options.emitInstallLog = true;
  }
  if (input.mergePatches !== undefined) {
    if (typeof input.mergePatches !== 'boolean') {
      throw new TypeError('lifecycle-bootstrap: mergePatches must be a boolean');
    }
    options.mergePatches = input.mergePatches;
  }
  if (input.dshHome !== undefined) {
    if (typeof input.dshHome !== 'string' || input.dshHome.length === 0) {
      throw new TypeError('lifecycle-bootstrap: dshHome must be a non-empty string');
    }
    options.dshHome = input.dshHome;
  }
  if (input.bundlePatchPath !== undefined) {
    if (typeof input.bundlePatchPath !== 'string' || input.bundlePatchPath.length === 0) {
      throw new TypeError('lifecycle-bootstrap: bundlePatchPath must be a non-empty string');
    }
    options.bundlePatchPath = input.bundlePatchPath;
  }
  if (input.maxOutputBytes !== undefined) {
    if (!Number.isInteger(input.maxOutputBytes) || input.maxOutputBytes <= 0) {
      throw new TypeError('lifecycle-bootstrap: maxOutputBytes must be a positive integer');
    }
    options.maxOutputBytes = input.maxOutputBytes;
  }
  return options;
}

/**
 * Cordis entry point.
 *
 * @param {object} ctx host context
 * @param {unknown} [config] plugin config
 * @returns {object} the service, so a test can drive it directly
 */
export function apply(ctx, config) {
  const options = readOptions(config);
  const service = createLifecycleBootstrap(ctx, options);

  if (typeof ctx?.provide === 'function') {
    ctx.provide('compatLifecycle', service);
  }
  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', () => {
      try {
        service.detach();
      } catch {
        /* Disposal must not throw; the host is already tearing down. */
      }
    });
  }
  // `attach` never rejects: it records its own failures and returns a promise
  // that settles once the baseline snapshot is taken.
  service.attach();
  return service;
}

export {
  BOOTSTRAP_LIMITATIONS,
  DEFAULT_BUNDLE_PATCH_PATH,
  LIFECYCLE_BOOTSTRAP_VERSION,
  LIFECYCLE_EVENTS,
  LIFECYCLE_SIGNALS,
  createLifecycleBootstrap,
};
