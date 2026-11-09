#!/bin/bash
# PREPARED NOT EXECUTED. Invoked only inside payload's bounded bwrap sandbox.
set -euo pipefail
stage=$1
cd /work
export PATH=/opt/node/bin:/usr/bin:/bin
export HOME=/work/home TMPDIR=/work/tmp
export NODE_OPTIONS=--max-old-space-size=192
export NPM_CONFIG_CACHE=/work/cache
export NPM_CONFIG_USERCONFIG=/work/user.npmrc NPM_CONFIG_GLOBALCONFIG=/work/global.npmrc
export NPM_CONFIG_PREFIX=/work/prefix
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
export NPM_CONFIG_IGNORE_SCRIPTS=true NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false
export NPM_CONFIG_FETCH_RETRIES=0 NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_ENGINE_STRICT=true NPM_CONFIG_WORKSPACES=false
export NPM_CONFIG_FETCH_TIMEOUT=30000 NPM_CONFIG_PROGRESS=false
/opt/node/bin/node /controls/inspect.mjs manifest package.json > manifest-review.json
/opt/node/bin/node --version > node-version.txt
/opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js --version > npm-version.txt
/opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js config list --json > npm-effective-config.json
if [ "$stage" = acquire ]; then
  /opt/node/bin/node /controls/inspect.mjs lock package-lock.json > reviewed-lock-inventory.json
fi
# Metadata is evidence from the registry, not a trusted endorsement.
# One request per direct candidate, no retries. Lock metadata/integrity and
# npm logs/cache are retained; full transitive lifecycle metadata requires
# inspection of packages acquired with scripts suppressed, not just this lock.
# Use the mounted counterparts of the hashed host Node and npm CLI for EVERY
# npm operation; never resolve npm through PATH or an npm shebang.
/opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js view @hyperjump/json-schema@1.18.0 --json > npm-metadata-json-schema.json
/opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js view @hyperjump/browser@1.6.0 --json > npm-metadata-browser.json
case "$stage" in
  resolve)
    /opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js install --package-lock-only --ignore-scripts --no-audit --no-fund > npm-operation.log 2>&1
    ;;
  acquire)
    /opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts --no-audit --no-fund > npm-operation.log 2>&1
    /opt/node/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js ls --all --json > npm-installed-tree.json
    ;;
  *) exit 70 ;;
esac
/opt/node/bin/node /controls/inspect.mjs lock package-lock.json > lock-inventory.json
sha256sum package.json package-lock.json > output-hashes.txt
printf 'stage=%s\noperation_complete=yes\n' "$stage" > operation-complete.txt
