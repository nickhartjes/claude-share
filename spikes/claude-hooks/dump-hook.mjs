// Spike hook command: writes the hook payload read from stdin to <outDir>/<n>-<event>.json.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
const payload = JSON.parse(readFileSync(0, 'utf8'));
mkdirSync(outDir, { recursive: true });
const n = String(readdirSync(outDir).length + 1).padStart(2, '0');
writeFileSync(join(outDir, `${n}-${payload.hook_event_name ?? 'unknown'}.json`), JSON.stringify(payload, null, 2));
