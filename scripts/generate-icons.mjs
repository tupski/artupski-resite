/**
 * Generates the Tauri app icon set from the brand mark - Artupski ReSite
 *
 * Source of truth for the artwork is the transparent square brand icon at
 * `docs/design/assets/Artupski ReSite Icon Transparent.png`. This script drives
 * the official Tauri CLI (`tauri icon`) so the PNG/ICO/ICNS outputs match what
 * the bundler expects, then prunes the mobile/Appx outputs the desktop-only
 * targets do not use.
 *
 * Run with: node scripts/generate-icons.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const source = resolve(repoRoot, 'docs/design/assets/Artupski ReSite Icon Transparent.png');
const outDir = resolve(repoRoot, 'src-tauri/icons');

if (!existsSync(source)) {
  console.error(`Brand icon not found: ${source}`);
  process.exit(1);
}

// 1) Generate every platform icon via the Tauri CLI (uses the official encoder).
//    Passed as one quoted command string through the shell so the source path
//    (which contains spaces) stays a single argument on both Windows and POSIX.
const tauriBin = resolve(repoRoot, 'node_modules/.bin/tauri');
const command = `"${tauriBin}" icon "${source}" --output "${outDir}"`;
const result = spawnSync(command, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true
});
if (result.status !== 0) {
  console.error('`tauri icon` failed.');
  process.exit(result.status ?? 1);
}

// 2) Prune outputs the desktop bundle targets (nsis/msi/dmg/app) never reference,
//    so the repository only carries the icons `tauri.conf.json` lists.
const prunedDirs = ['android', 'ios'];
for (const dir of prunedDirs) {
  rmSync(resolve(outDir, dir), { recursive: true, force: true });
}

for (const entry of readdirSync(outDir)) {
  const isUnused =
    entry === '64x64.png' || entry === 'StoreLogo.png' || entry.startsWith('Square');
  if (isUnused) {
    rmSync(resolve(outDir, entry), { force: true });
  }
}

console.log('Icon set regenerated in src-tauri/icons:', readdirSync(outDir).join(', '));
