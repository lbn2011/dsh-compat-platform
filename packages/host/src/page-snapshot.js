/**
 * `page-snapshot` — assemble a structural snapshot of what the GUI is showing.
 *
 * WHAT THIS IS. A projection of already-derived facts: which session is active,
 * which messages that session's surface holds, which plugins the host reports, and
 * which slot keys the renderer has announced. It is assembled on the host from the
 * session/event stream, so it works when a browser is not attached and when the
 * page is broken.
 *
 * WHAT THIS IS NOT. It is not a DOM, not a screenshot, and not a render. There is
 * no browser here: no `document`, no computed styles, no pixel geometry. A caller
 * that needs those must run a browser; this module will not pretend to have one,
 * and every response carries that limitation explicitly.
 *
 * TRUST BOUNDARY. The builder is pure: it takes plain values and returns a plain
 * value. It performs no I/O, holds no reference to a context, and never mutates
 * its input. Message text is withheld unless the caller opts in, because a message
 * body can carry anything a user typed.
 *
 * @module page-snapshot
 */

/** Schema identifier for the assembled snapshot. */
export const PAGE_SNAPSHOT_SCHEMA = 'page-snapshot-summary/0.1-draft.1';

/** Hard ceilings. Larger input is truncated and said to be truncated. */
export const PAGE_SNAPSHOT_LIMITS = Object.freeze({
  maxMessages: 50,
  maxMessageText: 512,
  maxPlugins: 200,
  maxSlots: 200,
});

/**
 * What a snapshot does not establish. Printed with every snapshot, because each
 * entry is a claim a reader might otherwise infer from the shape of the response.
 */
export const PAGE_SNAPSHOT_LIMITATIONS = Object.freeze([
  'SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT',
  'SNAPSHOT_IS_ASSEMBLED_FROM_HOST_STATE_NOT_OBSERVED_IN_A_BROWSER',
  'MESSAGE_TEXT_IS_WITHHELD_UNLESS_EXPLICITLY_REQUESTED',
  'SLOT_KEYS_ARE_EVENT_DERIVED_AND_MAY_BE_STALE',
  'NO_RUNTIME_VALIDATION_PERFORMED',
]);

/** Closed source states for one part of the snapshot. */
export const PAGE_SNAPSHOT_SOURCES = Object.freeze(['provided', 'unavailable', 'not-requested']);

/** Closed refusal/diagnostic codes. */
export const PAGE_SNAPSHOT_CODES = Object.freeze([
  'SNAPSHOT_INPUT_NOT_RECORD',
  'SESSIONS_UNAVAILABLE',
  'MESSAGES_UNAVAILABLE',
  'PLUGINS_UNAVAILABLE',
  'SLOTS_UNAVAILABLE',
  'ACTIVE_SESSION_UNKNOWN',
  'MESSAGE_WINDOW_TRUNCATED',
  'MESSAGE_TEXT_TRUNCATED',
  'PLUGIN_LIST_TRUNCATED',
  'SLOT_LIST_TRUNCATED',
  'ENTRY_SKIPPED_MALFORMED',
]);

/**
 * Is this an ordinary record (not an array, not null, not a class instance)?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped objects.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A bounded string, or null. Never coerces.
 *
 * @param {unknown} value Candidate.
 * @param {number} max Maximum length in UTF-16 code units.
 * @returns {{value: string, truncated: boolean}|null} The bounded string.
 */
function boundedString(value, max) {
  if (typeof value !== 'string') return null;
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max), truncated: true };
}

/**
 * Project one plugin row onto the structural fields the snapshot reports.
 *
 * @param {unknown} row A `PluginInfo`-shaped value.
 * @returns {object|null} Projected row, or null when it cannot be read.
 */
function projectPlugin(row) {
  if (!isRecord(row)) return null;
  const entryId = typeof row.entryId === 'string' ? row.entryId : null;
  const moduleName = typeof row.moduleName === 'string' ? row.moduleName : null;
  if (entryId === null && moduleName === null) return null;
  return {
    entryId,
    moduleName,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
    fiberPhase: typeof row.fiberPhase === 'string' ? row.fiberPhase : null,
    hasDiagnostic: isRecord(row.diagnostic) && Object.keys(row.diagnostic).length > 0,
  };
}

/**
 * Project one slot entry onto `{key, count}`.
 *
 * @param {unknown} row A slot row or a bare key.
 * @returns {object|null} Projected row, or null when it cannot be read.
 */
function projectSlot(row) {
  if (typeof row === 'string') {
    return row.length > 0 ? { key: row, count: null } : null;
  }
  if (!isRecord(row) || typeof row.key !== 'string' || row.key.length === 0) return null;
  const count = Number.isInteger(row.count) && row.count >= 0 ? row.count : null;
  return { key: row.key, count };
}

/**
 * Project one message onto its structural shape.
 *
 * @param {unknown} message A projected message value.
 * @param {number} index Position in the projected list.
 * @param {boolean} includeText Whether the caller asked for message text.
 * @returns {{row: object|null, textTruncated: boolean}} Projection and a flag.
 */
function projectMessage(message, index, includeText) {
  if (!isRecord(message)) return { row: null, textTruncated: false };
  const id = typeof message.id === 'string' ? message.id : null;
  const role = typeof message.role === 'string' ? message.role : null;
  if (id === null && role === null) return { row: null, textTruncated: false };

  const row = {
    index,
    id,
    role,
    textLength: typeof message.text === 'string' ? message.text.length : null,
    text: null,
  };
  if (!includeText || typeof message.text !== 'string') return { row, textTruncated: false };

  const bounded = boundedString(message.text, PAGE_SNAPSHOT_LIMITS.maxMessageText);
  row.text = bounded.value;
  return { row, textTruncated: bounded.truncated };
}

/**
 * Assemble a structural snapshot from plain host values.
 *
 * Every part is optional: an absent part becomes `sources.<part> = 'unavailable'`
 * plus a code, never an empty list that would read as "there is nothing". That
 * distinction is the point of the module — "I could not see it" and "it is empty"
 * are different facts and must not collapse.
 *
 * @param {{
 *   sessions?: unknown,
 *   messages?: unknown,
 *   plugins?: unknown,
 *   slots?: unknown,
 *   activeSessionId?: unknown,
 *   includeMessageText?: unknown,
 * }} [input] Plain values read from the host.
 * @returns {object} A frozen snapshot summary. Never throws for JSON values.
 */
export function buildPageSnapshot(input = {}) {
  if (!isRecord(input)) {
    return refuse('SNAPSHOT_INPUT_NOT_RECORD');
  }

  const codes = [];
  const sources = {
    sessions: Array.isArray(input.sessions) ? 'provided' : 'unavailable',
    messages: Array.isArray(input.messages) ? 'provided' : 'unavailable',
    plugins: Array.isArray(input.plugins) ? 'provided' : 'unavailable',
    slots: Array.isArray(input.slots) ? 'provided' : 'unavailable',
  };
  if (sources.sessions === 'unavailable') codes.push('SESSIONS_UNAVAILABLE');
  if (sources.messages === 'unavailable') codes.push('MESSAGES_UNAVAILABLE');
  if (sources.plugins === 'unavailable') codes.push('PLUGINS_UNAVAILABLE');
  if (sources.slots === 'unavailable') codes.push('SLOTS_UNAVAILABLE');

  const activeSessionId = typeof input.activeSessionId === 'string' && input.activeSessionId.length > 0
    ? input.activeSessionId
    : null;
  const knownSessions = sources.sessions === 'provided'
    ? input.sessions.filter((row) => isRecord(row) && typeof row.id === 'string')
    : [];
  if (activeSessionId !== null && sources.sessions === 'provided'
    && !knownSessions.some((row) => row.id === activeSessionId)) {
    codes.push('ACTIVE_SESSION_UNKNOWN');
  }

  const includeMessageText = input.includeMessageText === true;
  const rawMessages = sources.messages === 'provided' ? input.messages : [];
  const messageRows = [];
  let textTruncated = false;
  for (const message of rawMessages) {
    if (messageRows.length >= PAGE_SNAPSHOT_LIMITS.maxMessages) break;
    const projected = projectMessage(message, messageRows.length + 1, includeMessageText);
    if (projected.row === null) {
      if (!codes.includes('ENTRY_SKIPPED_MALFORMED')) codes.push('ENTRY_SKIPPED_MALFORMED');
      continue;
    }
    if (projected.textTruncated) textTruncated = true;
    messageRows.push(projected.row);
  }
  const messagesTruncated = rawMessages.length > messageRows.length;
  if (messagesTruncated) codes.push('MESSAGE_WINDOW_TRUNCATED');
  if (textTruncated) codes.push('MESSAGE_TEXT_TRUNCATED');

  const rawPlugins = sources.plugins === 'provided' ? input.plugins : [];
  const pluginRows = [];
  for (const row of rawPlugins) {
    if (pluginRows.length >= PAGE_SNAPSHOT_LIMITS.maxPlugins) break;
    const projected = projectPlugin(row);
    if (projected === null) {
      if (!codes.includes('ENTRY_SKIPPED_MALFORMED')) codes.push('ENTRY_SKIPPED_MALFORMED');
      continue;
    }
    pluginRows.push(projected);
  }
  const pluginsTruncated = rawPlugins.length > pluginRows.length;
  if (pluginsTruncated) codes.push('PLUGIN_LIST_TRUNCATED');

  const rawSlots = sources.slots === 'provided' ? input.slots : [];
  const slotRows = [];
  for (const row of rawSlots) {
    if (slotRows.length >= PAGE_SNAPSHOT_LIMITS.maxSlots) break;
    const projected = projectSlot(row);
    if (projected === null) {
      if (!codes.includes('ENTRY_SKIPPED_MALFORMED')) codes.push('ENTRY_SKIPPED_MALFORMED');
      continue;
    }
    slotRows.push(projected);
  }
  const slotsTruncated = rawSlots.length > slotRows.length;
  if (slotsTruncated) codes.push('SLOT_LIST_TRUNCATED');

  return Object.freeze({
    pageSnapshot: PAGE_SNAPSHOT_SCHEMA,
    activeSession: activeSessionId === null
      ? null
      : {
        id: activeSessionId,
        known: sources.sessions === 'provided'
          ? knownSessions.some((row) => row.id === activeSessionId)
          : null,
      },
    messages: Object.freeze(messageRows.map((row) => Object.freeze(row))),
    plugins: Object.freeze(pluginRows.map((row) => Object.freeze(row))),
    slots: Object.freeze(slotRows.map((row) => Object.freeze(row))),
    sources: Object.freeze(sources),
    messageTextIncluded: includeMessageText,
    counts: Object.freeze({
      messages: messageRows.length,
      messagesTotal: rawMessages.length,
      plugins: pluginRows.length,
      pluginsTotal: rawPlugins.length,
      slots: slotRows.length,
      slotsTotal: rawSlots.length,
      sessions: knownSessions.length,
    }),
    truncated: Object.freeze({
      messages: messagesTruncated,
      messageText: textTruncated,
      plugins: pluginsTruncated,
      slots: slotsTruncated,
    }),
    codes: Object.freeze(codes),
    limits: PAGE_SNAPSHOT_LIMITS,
    limitations: PAGE_SNAPSHOT_LIMITATIONS,
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
  });
}

/**
 * A snapshot-shaped refusal for unusable input.
 *
 * @param {string} code A member of `PAGE_SNAPSHOT_CODES`.
 * @returns {object} Frozen snapshot with no data and the refusal code.
 */
function refuse(code) {
  return Object.freeze({
    pageSnapshot: PAGE_SNAPSHOT_SCHEMA,
    activeSession: null,
    messages: Object.freeze([]),
    plugins: Object.freeze([]),
    slots: Object.freeze([]),
    sources: Object.freeze({
      sessions: 'unavailable',
      messages: 'unavailable',
      plugins: 'unavailable',
      slots: 'unavailable',
    }),
    messageTextIncluded: false,
    counts: Object.freeze({
      messages: 0,
      messagesTotal: 0,
      plugins: 0,
      pluginsTotal: 0,
      slots: 0,
      slotsTotal: 0,
      sessions: 0,
    }),
    truncated: Object.freeze({
      messages: false,
      messageText: false,
      plugins: false,
      slots: false,
    }),
    codes: Object.freeze([code]),
    limits: PAGE_SNAPSHOT_LIMITS,
    limitations: PAGE_SNAPSHOT_LIMITATIONS,
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
  });
}

/**
 * A slot-key cache fed by `slots/changed`, so the snapshot can report slot keys
 * even though the host never owns the renderer's slot table.
 *
 * `slots/changed` carries one key and says nothing about removals, so this cache
 * learns keys and never forgets them. It is therefore a lower bound on the set of
 * keys ever announced, not a picture of the current page — which is exactly the
 * limitation `SLOT_KEYS_ARE_EVENT_DERIVED_AND_MAY_BE_STALE` records.
 *
 * @param {{maxKeys?: number}} [options] Cache size.
 * @returns {{record: (key: unknown) => boolean, list: () => object[], clear: () => void,
 *   size: () => number, dropped: () => number}} A bounded slot-key cache.
 */
export function createSlotCache(options = {}) {
  const maxKeys = Number.isInteger(options.maxKeys) && options.maxKeys > 0 ? options.maxKeys : 200;
  const seen = new Map();
  let dropped = 0;

  return {
    record(key) {
      if (typeof key !== 'string' || key.length === 0) return false;
      if (!seen.has(key)) {
        if (seen.size >= maxKeys) {
          dropped += 1;
          return false;
        }
        seen.set(key, { key, count: null });
      }
      return true;
    },
    list() {
      return [...seen.values()];
    },
    clear() {
      seen.clear();
      dropped = 0;
    },
    size() {
      return seen.size;
    },
    dropped() {
      return dropped;
    },
  };
}
