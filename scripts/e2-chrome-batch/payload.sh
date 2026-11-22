#!/bin/bash
# E2 Chrome batch payload: a live Chromium smoke (chrome-live), the UI Phase 3-4
# browser E2E (ui-e2e.mjs, real host routes on a temp server), then the full
# packages/host test suite.
#
# CHROME_PATH is NOT inherited: the transient unit starts with a clean environment
# and run.sh passes no --setenv, so the payload always auto-discovers the binary
# (/usr/bin/chromium, /usr/bin/chromium-browser, /usr/bin/google-chrome, then the
# first executable "chrome" under /data/chromium) and records it in chrome-path.txt.
# Each child process then gets that path through its own env -i line.
set +e
set -uo pipefail
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
PKG=$REPO/packages/host
SLICE=$REPO/scripts/e2-chrome-batch
CORE=$REPO/scripts/bounded-runner
NODE=/www/server/nodejs/v24.21.0/bin/node
source "$CORE/common.sh" || exit 70
source "$CORE/policy.sh" || exit 70
source "$CORE/envelope.sh" || exit 70
[ "$#" -eq 2 ] || exit 70
br_unit "$1" && br_path "$2" && [ -d "$2" ] || exit 70
BR_UNIT=$1 BR_RUN=$2
RUN=$BR_RUN

# Opens evidence BEFORE each command; failed opens are 73.
capture() {
  local out=$1 err=$2 rc; shift 2
  br_evidence_gate || return 73
  if ! exec 7>"$out"; then br_write_failure "$out"; return 73; fi
  if ! exec 8>"$err"; then br_write_failure "$err"; exec 7>&-; return 73; fi
  br_evidence_gate || { exec 7>&- 8>&-; return 73; }
  "$@" >&7 2>&8; rc=$?
  exec 7>&- 8>&-
  return "$rc"
}

# ---------------------------------------------------------------------------
# Discover the Chromium binary (the payload environment never carries CHROME_PATH).
# ---------------------------------------------------------------------------
discover_chrome() {
  local candidate
  for candidate in \
    /usr/bin/chromium \
    /usr/bin/chromium-browser \
    /usr/bin/google-chrome \
    "$(find /data/chromium -name 'chrome' -type f -perm /u+x 2>/dev/null | sort | head -1)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

chrome_payload() {
  local rc node_rc tap_rc k value state chrome_live_rc
  local acc_syntax_run_sh_rc acc_syntax_payload_sh_rc
  source "$CORE/tap.sh" || return 70
  br_envelope_enter "$BR_UNIT" "$BR_RUN"; rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  [ -d "$PKG" ] && [ -x "$NODE" ] || return 70

  # Syntax-check this wrapper and run.sh.
  capture "$RUN/syntax-run.log" "$RUN/syntax-run.err" /bin/bash -n "$SLICE/run.sh"; acc_syntax_run_sh_rc=$?
  br_evidence_gate || return 73
  capture "$RUN/syntax-payload.log" "$RUN/syntax-payload.err" /bin/bash -n "$SLICE/payload.sh"; acc_syntax_payload_sh_rc=$?
  br_record "$RUN/syntax.txt" 'acc_syntax_run_sh_rc=%s\nacc_syntax_payload_sh_rc=%s\n' \
    "$acc_syntax_run_sh_rc" "$acc_syntax_payload_sh_rc" || :
  br_evidence_gate || return 73
  [ "$acc_syntax_run_sh_rc" -eq 0 ] && [ "$acc_syntax_payload_sh_rc" -eq 0 ] || return 71

  # Discover / record the chrome binary path.
  CHROME_PATH="$(discover_chrome 2>/dev/null)" || CHROME_PATH=''
  br_record "$RUN/chrome-path.txt" 'chrome_path=%s\nchrome_available=%s\n' \
    "$CHROME_PATH" "$([ -n "$CHROME_PATH" ] && echo yes || echo no)" || :
  br_evidence_gate || return 73

  # Real Chromium live-capture test (non-production: local temp server on a random port).
  if [ -n "$CHROME_PATH" ]; then
    capture "$RUN/chrome-live.log" "$RUN/chrome-live.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin:"${NODE%/node}" HOME=/root TMPDIR=/root/kit-scratch/tmp \
      NODE_OPTIONS="$BR_NODE_OPTIONS" CHROME_PATH="$CHROME_PATH" \
      "$NODE" --input-type=module <<'CHROME_LIVE_EOF'
import { createServer } from 'node:http'
import { ChromeDriver } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/host/src/chrome-driver.js'

// Start a minimal local HTTP server on a random OS-assigned port.
const html = '<html><head><title>e2-chrome-test</title></head><body><p id="p1">hello</p><form></form></body></html>'
const srv = createServer((req, res) => { res.writeHead(200, {'content-type':'text/html'}); res.end(html) })
await new Promise((ok, fail) => srv.listen(0, '127.0.0.1', (err) => err ? fail(err) : ok()))
const port = srv.address().port
const url = `http://127.0.0.1:${port}/`
let driver
try {
  // launch(executablePath, options) — positional first arg, not an options object.
  driver = await ChromeDriver.launch(process.env.CHROME_PATH)
  await driver.navigate(url)
  const dom = await driver.captureDOM()
  if (!dom.title || dom.elementCount < 3) throw new Error(`captureDOM unexpected: title=${JSON.stringify(dom.title)} elementCount=${dom.elementCount}`)
  process.stdout.write(JSON.stringify({ok:true, title: dom.title, elementCount: dom.elementCount, url: dom.url}) + '\n')
} finally {
  if (driver) await driver.close().catch(() => {})
  srv.close()
}
CHROME_LIVE_EOF
    chrome_live_rc=$?
    br_record "$RUN/chrome-live-rc.txt" 'chrome_live_rc=%s\n' "$chrome_live_rc" || :
    br_evidence_gate || return 73
    [ "$chrome_live_rc" -eq 0 ] || return 72

    # UI Phase 3–4 real-browser E2E: real renderPage() HTML and real host API routes
    # (createHostApi + createConflictService + dsh-compat-repair on a mkdtemp copy).
    local ui_e2e_rc
    capture "$RUN/ui-e2e.log" "$RUN/ui-e2e.err" \
      /usr/bin/env -i PATH=/usr/bin:/bin:"${NODE%/node}" HOME=/root TMPDIR=/root/kit-scratch/tmp \
      NODE_OPTIONS="$BR_NODE_OPTIONS" CHROME_PATH="$CHROME_PATH" \
      "$NODE" "$SLICE/ui-e2e.mjs" "$RUN"
    ui_e2e_rc=$?
    br_record "$RUN/ui-e2e-rc.txt" 'ui_e2e_rc=%s\n' "$ui_e2e_rc" || :
    br_evidence_gate || return 73
    [ "$ui_e2e_rc" -eq 0 ] || return 72
  else
    br_record "$RUN/chrome-live-rc.txt" 'chrome_live_rc=skipped\nreason=no_chrome_binary\n' || :
  fi

  # Run the full packages/host test suite (unit mocks — no real browser needed).
  br_record "$RUN/workload.txt" 'node=%s\nworkdir=%s\ntest_glob=%s\nchrome_path=%s\n' \
    "$NODE" "$PKG" 'tests/*.test.js' "$CHROME_PATH" || :
  capture "$RUN/node-tap.log" "$RUN/node-stderr.log" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp TMPDIR=/root/kit-scratch/tmp \
    NODE_OPTIONS="$BR_NODE_OPTIONS" \
    CHROME_PATH="$CHROME_PATH" \
    "$NODE" --test --test-concurrency=1 --test-reporter=tap "$PKG/tests/*.test.js"
  node_rc=$?
  br_record "$RUN/node.rc" 'node_rc=%s\n' "$node_rc" || :
  cat "$RUN/node-tap.log" || br_write_failure tap-relay
  br_evidence_gate || return 73
  br_tap_check "$RUN/node-tap.log" "$node_rc"; tap_rc=$?
  br_record "$RUN/tap-fields.txt" '%s' '' || :
  br_record "$RUN/tap-summary.txt" '%s' '' || :
  for k in tests pass fail cancelled skipped todo; do
    state=ok
    value=$(br_tap_value "$RUN/node-tap.log" "$k") || { state=invalid; value='<invalid>'; }
    printf 'tap_field_%s=%s\n' "$k" "$state" >> "$RUN/tap-fields.txt" || br_write_failure tap-fields.txt
    printf 'tap_%s=%s\n' "$k" "$value" >> "$RUN/tap-summary.txt" || br_write_failure tap-summary.txt
  done
  state=pass; [ "$tap_rc" -eq 0 ] || state=fail
  br_record "$RUN/tap-verdict.txt" 'tests_exit=%s\ntap_check_rc=%s\nverdict=%s\n' "$node_rc" "$tap_rc" "$state" || :
  return "$tap_rc"
}
chrome_payload
rc=$?
br_payload_finish "$rc"
exit "$?"
