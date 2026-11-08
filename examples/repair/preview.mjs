#!/usr/bin/env node
/**
 * Print what `examples/repair/plan.json` would change in
 * `examples/repair/profile.yml`. Reads two files, writes nothing, and is the only
 * executable in this example: it is a preview, not a repair.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { previewRepair, renderPreview } from '../../packages/repair/src/repair-preview.js';

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, 'plan.json'), 'utf8'));
const beforeText = readFileSync(join(here, 'profile.yml'), 'utf8');

process.stdout.write(renderPreview(previewRepair({ plan, beforeText })));
