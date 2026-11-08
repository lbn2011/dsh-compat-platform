#!/bin/bash
# Bounded launcher for the trusted-extraction observation.
#
# STATUS: prepared for review. One invocation = one bounded round.
set -u
REPO=/root/dsh-ecosystem-spec/projects/dsh-compat-platform
SLICE=$REPO/scripts/trusted-extraction-batch
RUNS=${TRUSTED_EXTRACTION_RUNS_ROOT:-/data/dsh-ecosystem-test-artifacts/runs}
LOCKFILE=/root/dsh-ecosystem-spec/experiments/acceptance/runs/.acceptance.lock
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
UNIT="trusted-extraction-batch-$$-$(date +%s)"
RUN_DIR=$RUNS/$STAMP-$UNIT
mkdir -p "$RUN_DIR" || exit 75

exec 9>"$LOCKFILE" || exit 76
flock -n 9 || { echo "another acceptance run holds the lock" >&2; exit 77; }

hashset() { ( cd "$REPO" && sha256sum "$@" ); }
HASHED=(scripts/trusted-extraction-batch/run.sh scripts/trusted-extraction-batch/payload.sh
        packages/runtime/package.json packages/runtime/src/isolation-policy.js
        packages/runtime/src/child-probe.js packages/runtime/src/trusted-extraction-adapter.js
        packages/runtime/src/trusted-extraction-receipt.js packages/runtime/src/trusted-extraction-supervisor.js
        packages/runtime/tests/isolation-policy.test.js packages/runtime/tests/trusted-extraction-receipt.test.js
        scripts/trusted-extraction-batch/failure-paths.mjs
        examples/trusted-extraction/config.yml examples/trusted-extraction/plugin-ok.mjs
        examples/trusted-extraction/plugin-import-throw.mjs examples/trusted-extraction/plugin-activate-throw.mjs
        examples/trusted-extraction/config-hang.yml examples/trusted-extraction/plugin-hang.mjs)
hashset "${HASHED[@]}" > "$RUN_DIR/hashes-before.txt" || exit 75

systemd-run --unit "$UNIT" --wait --pipe --collect \
  -p MemoryMax=402653184 -p MemorySwapMax=0 -p TasksMax=32 \
  -p CPUQuota=50% -p RuntimeMaxSec=120 -p PrivateTmp=no \
  /bin/bash "$SLICE/payload.sh" "$RUN_DIR" > "$RUN_DIR/payload.log" 2>&1
rc=$?
printf 'payload_rc=%s\n' "$rc" > "$RUN_DIR/payload-rc.txt"
printf 'run_dir=%s\n' "$RUN_DIR" > "$RUN_DIR/status.txt"
printf 'unit=%s\n' "$UNIT" >> "$RUN_DIR/status.txt"
printf 'finished_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RUN_DIR/status.txt"
hashset "${HASHED[@]}" > "$RUN_DIR/hashes-after.txt" || exit 75
if cmp -s "$RUN_DIR/hashes-before.txt" "$RUN_DIR/hashes-after.txt"; then
  printf 'hashes=identical\n' >> "$RUN_DIR/status.txt"
else
  printf 'hashes=CHANGED\n' >> "$RUN_DIR/status.txt"
fi
systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p MainPID >> "$RUN_DIR/terminal.txt" 2>&1 || true
{
  echo "acceptance_exit=$rc"
  echo "run_dir=$RUN_DIR"
  grep -E '^(verdict|isolation_exit|fixture_exit|failure_paths_exit|tests_exit|static_contract)=' "$RUN_DIR"/*.txt 2>/dev/null || true
  grep -E '^(memory_peak|pids_peak)=' "$RUN_DIR/peaks.txt" 2>/dev/null || true
} | tee "$RUN_DIR/summary.txt"
exit "$rc"
