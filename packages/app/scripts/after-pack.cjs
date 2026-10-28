// electron-builder afterPack hook. node-pty 1.1.0 ships its macOS spawn-helper without the executable
// bit; without it every terminal fails with "posix_spawnp failed" (docs/spikes/snapshot-fidelity.md).
const { chmodSync, existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = readdirSync(context.appOutDir).find((name) => name.endsWith('.app'));
  const unpacked = join(context.appOutDir, app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds');
  if (!existsSync(unpacked)) throw new Error(`node-pty prebuilds not found in ${unpacked}`);
  for (const arch of readdirSync(unpacked)) {
    const helper = join(unpacked, arch, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
};
