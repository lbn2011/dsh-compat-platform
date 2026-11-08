/**
 * TEST DOUBLE — not a protocol implementation.
 *
 * Mirrors the *documented* dsh-compat-spec contract:
 *
 *   validateDeclaration(value) -> { valid: boolean, issues: [{ code, path, message }] }
 *
 * shape rules, so this repository's tests stay hermetic (no npm dependency, no
 * sibling path import). It deliberately does not reproduce every protocol
 * message or every rule: production callers inject the real validator.
 *
 * The one rule it enforces strictly — and that this repository's fixtures rely
 * on — is that `scope` is an OPEN, caller-supplied, non-empty trimmed string,
 * not a closed enum. Nothing here narrows it to `plugin|shared`.
 *
 * On shape drift: extra object fields are tolerated on purpose. They are what
 * makes a shape test meaningful — a wrapper like `{ value: {...} }` must be
 * accepted here and then be inexpressible as a declaration, so a test can tell
 * whether the *analyzer* consumed the raw declaration or unwrapped it.
 * `schemaVersion` and the required `resources` array are enforced.
 */
const PROTOCOL_VERSION = '0.1.0-draft.1';
const RESOURCE_KINDS = ['tool', 'service'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isName(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;
  if (value.trim() !== value) return false;
  return !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value);
}

export function validateDeclaration(value) {
  const issues = [];
  const push = (code, path, message) => issues.push({ code, path, message });

  if (!isPlainObject(value)) {
    push(
      'TYPE_MISMATCH',
      '',
      `Declaration must be an object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}.`,
    );
    return { valid: false, issues };
  }

  if (value.schemaVersion !== PROTOCOL_VERSION) {
    push('INVALID_VALUE', 'schemaVersion', `schemaVersion must equal ${JSON.stringify(PROTOCOL_VERSION)}.`);
  }

  if (!isPlainObject(value.plugin)) {
    push('TYPE_MISMATCH', 'plugin', 'plugin must be an object.');
  } else {
    for (const field of ['id', 'version']) {
      if (!isName(value.plugin[field])) {
        push('INVALID_VALUE', `plugin.${field}`, `plugin.${field} must be a non-empty trimmed string.`);
      }
    }
  }

  if (!isPlainObject(value.capabilities)) {
    push('TYPE_MISMATCH', 'capabilities', 'capabilities must be an object.');
  } else {
    for (const field of ['required', 'optional']) {
      const list = value.capabilities[field];
      if (!Array.isArray(list)) {
        push('TYPE_MISMATCH', `capabilities.${field}`, `capabilities.${field} must be an array.`);
        continue;
      }
      const seen = new Set();
      list.forEach((entry, index) => {
        if (!isName(entry)) {
          push('INVALID_VALUE', `capabilities.${field}[${index}]`, 'capability must be a non-empty trimmed string.');
        } else if (seen.has(entry)) {
          push('INVALID_VALUE', `capabilities.${field}[${index}]`, 'duplicate capability in list.');
        } else {
          seen.add(entry);
        }
      });
    }
  }

  // `resources` is a required array per the protocol contract.
  if (!Array.isArray(value.resources)) {
    push(
      'TYPE_MISMATCH',
      'resources',
      `resources is required and must be an array, got ${value.resources === undefined ? 'undefined' : value.resources === null ? 'null' : typeof value.resources}.`,
    );
  } else {
    value.resources.forEach((entry, index) => {
      const base = `resources[${index}]`;
      if (!isPlainObject(entry)) {
        push('TYPE_MISMATCH', base, `${base} must be an object.`);
        return;
      }
      if (!RESOURCE_KINDS.includes(entry.kind)) {
        push('INVALID_VALUE', `${base}.kind`, `${base}.kind must be one of tool, service.`);
      }
      if (!isName(entry.name)) {
        push('INVALID_VALUE', `${base}.name`, `${base}.name must be a non-empty trimmed string.`);
      }
      // Scope stays open on purpose: any non-empty trimmed string is a valid
      // static label. A closed enum here would be a duplicated protocol rule
      // the real protocol does not have.
      if (!isName(entry.scope)) {
        push(
          'INVALID_VALUE',
          `${base}.scope`,
          `${base}.scope must be a non-empty trimmed string; the label value is caller-supplied.`,
        );
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

export default validateDeclaration;
