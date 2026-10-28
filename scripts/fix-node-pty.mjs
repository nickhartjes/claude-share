// node-pty 1.1.0 ships its macOS spawn-helper without the executable bit, so every spawn fails
// with "posix_spawnp failed". Restore it after install. Packaging sets it separately (task 11.1).
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const store = 'node_modules/.pnpm';
if (process.platform === 'darwin' && existsSync(store)) {
  for (const entry of readdirSync(store).filter((name) => name.startsWith('node-pty@'))) {
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      const helper = join(store, entry, 'node_modules/node-pty/prebuilds', arch, 'spawn-helper');
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
}
