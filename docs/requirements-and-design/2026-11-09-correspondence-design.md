# Correspondence: matching a profile row to a declaration without disclosing text

Status: design, decided 2026-11-09. Implementation follows this document.

## 0. Decisions

- **Decided (user, 2026-11-09):** option C — the match is a **caller assertion**, carried in its
  own artifact, and the tool only *verifies* the assertion. Neither the profile-dump summary nor
  the declaration document changes shape, and no plugin name, entry id, path or config value is
  ever written to any output.
- **Decided:** a third shape bump of `profile-dump` was rejected for this slice. The summarizer's
  safety decisions are reused as-is (it is called first and any refusal stops the check); identity
  text is read by a narrow, count-checked scan that never leaves the process.
- **Pending:** whether a later slice lets a caller opt in to id/name disclosure (the literal D-A
  wording). Not needed for this one, and it would need a protocol field the spec does not have.

## 1. Why not the literal D-A

`D-A` (p2-gap-review.md:88-91) proposes an opt-in mode that emits entry `id`/`name` text. Three
facts make that insufficient on its own:

| Fact | Evidence |
| --- | --- |
| `id` is optional; when absent the loader invents an 8-hex id | `.cache/upstream/vendor/loader/src/config/tree.ts:52-59` |
| Two entries with the same `id` are silently collapsed — the second replaces the first, no error | `.cache/upstream/vendor/loader/src/config/group.ts:22`, `config/entry.ts:121-126` |
| A declaration has no module-specifier field at all (`plugin` is only `id` + `version`) | `projects/dsh-compat-spec/src/index.js:43-48` |

So disclosure alone would still leave: an id that may not exist, an id that may be ambiguous, and
a `name` on the profile side with nothing on the declaration side to match it against. Disclosure
also re-opens the leak surface the current design closed (profile-dump.js:14-17).

The assertion route moves the ambiguity into an artifact a human can be held to, and turns every
way the assertion can be wrong into a **refusal** rather than a wrong verdict.

## 2. Artifact: `profile-correspondence/0.1-draft.1`

```json
{
  "correspondenceVersion": "profile-correspondence/0.1-draft.1",
  "bindings": { "profileSha256": "<64 hex>", "declarationSha256": "<64 hex>" },
  "pairs": [ { "entryId": "example-a", "pluginId": "example.plugin-alpha", "note": "optional" } ]
}
```

Closed key set at both levels; `pairs` is a non-empty array; `entryId` and `pluginId` are
non-empty trimmed labels (no control characters, no U+2028/U+2029), unique within their own list;
`note` is optional and, if present, a string. Nothing here is trusted: it is the caller's claim.

## 3. What the check does

Input: the correspondence file, the profile dump text, and an analyzer input document
(`{declarations, availableCapabilities}` — the same shape `--static` takes).

1. **Binding.** Recompute sha256 of the profile bytes and of the declaration bytes. Any mismatch
   with `bindings` ⇒ `refused` / `CORRESPONDENCE_STALE`. This is what stops a correspondence from
   being replayed against different bytes.
2. **Profile safety.** Call `summarizeProfileDumpText(text)` first. If it refuses, the check
   refuses with the summarizer's own code — no second opinion, no partial read.
3. **Id scan.** A narrow scan for `- ` record openers and literal `  id: <value>` lines. The number
   of openers must equal `counts.entries`; a non-literal or missing id makes *that entry*
   unaddressable, not the document unreadable.
4. **Resolve each asserted `entryId`.** Zero matches ⇒ `refused` / `CORRESPONDENCE_ENTRY_NOT_FOUND`;
   more than one ⇒ `refused` / `CORRESPONDENCE_ENTRY_AMBIGUOUS`. The duplicate case is exactly the
   silent collapse the loader performs, so it is a refusal, never a guess.
5. **Check each pair** and emit findings (exit 1 when any finding exists):
   - `CORRESPONDENCE_PLUGIN_NOT_DECLARED` — no declaration in the document has that `plugin.id`.
   - `CORRESPONDENCE_DUPLICATE_PLUGIN_ID` — two asserted pairs name the same `pluginId`.
   - `CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES` — the asserted entry is `disabled: true`
     and its declaration declares at least one capability or resource. A disabled entry does not
     load, so the declared capabilities will not be provided.

## 4. What the check deliberately does not do

| Not checked | Why |
| --- | --- |
| Version correspondence | `EntryOptions` has no version field (`.cache/upstream/vendor/loader/src/config/entry.ts:8-24`); a dump cannot carry one without resolving the module, which the trust boundary forbids |
| Config values | never read; the summary only knows `mapping` / `not-mapping` and key counts |
| Capability satisfaction | a declaration saying `required: [x]` is not evidence that `x` exists |
| Row-set completeness | denied bundles contribute no row (unchanged from the dump's own limitation) |
| Identity of its own | the correspondence is an assertion; `identitySource` is always `"caller-asserted"` |

## 5. Output document: `correspondence-summary/0.1-draft.1`

```json
{
  "correspondenceSummary": "correspondence-summary/0.1-draft.1",
  "identitySource": "caller-asserted",
  "bindings": { "profileSha256": "...", "declarationSha256": "..." },
  "pairs": [
    { "index": 1, "line": 2, "disabled": "false", "config": "mapping",
      "keyCount": 3, "unmodelledKeyCount": 0, "pluginDeclared": true,
      "capabilitiesRequired": 1, "capabilitiesOptional": 0,
      "resources": { "tool": 1, "service": 0 }, "findings": [] }
  ],
  "findings": [],
  "counts": { "pairs": 1, "matched": 1, "refused": 0, "findings": 0 },
  "certification": false,
  "correlation": "not-established",
  "identityDisclosed": false,
  "notDerived": ["declarations", "availableCapabilities", "resources", "activation",
                 "loadability", "dependencyResolution", "identity"],
  "limitations": ["IDENTITY_IS_CALLER_ASSERTED", "NO_VERSION_CORRESPONDENCE",
                  "CONFIG_VALUES_NOT_COMPARED", "CAPABILITY_SATISFACTION_NOT_CHECKED",
                  "ROW_SET_COMPLETENESS_UNKNOWN", "IDENTITY_TEXT_NEVER_EMITTED",
                  "CERTIFICATION_NOT_CLAIMED", "INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX"]
}
```

No `entryId`, `pluginId`, `note`, path or config key appears anywhere in the output. Pairs are
identified by their position in the correspondence file (`index`, 1-based) and the line of the
matched profile row.

## 6. Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every asserted pair resolved and no finding |
| 1 | at least one finding (attention) |
| 2 | refused: stale bindings, malformed correspondence, unreadable profile, entry not found or ambiguous |
| 5 | internal error, or stdout could not be written |
| 64 | usage |

## 7. Landing

`packages/analyzer/src/correspondence.js` (pure), `correspondence.d.ts`,
`correspondence-cli.js` (`dsh-compat-correspondence`), `tests/correspondence.test.js`,
`examples/correspondence/{profile.yml,declaration.json,correspondence.json}`,
`scripts/correspondence-batch/`, a record under `docs/testing/`, README §15 and two
`package.json` entries (bin + exports). The profile and host packages are untouched.
