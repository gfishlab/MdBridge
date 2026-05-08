#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import process from 'node:process';

const repoRoot = new URL('..', import.meta.url).pathname;
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const value = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
      ? process.argv[++i]
      : 'true';
    args.set(key, value);
  }
}

const version = args.get('version') || packageJson.version;
const tag = args.get('tag') || `v${version}`;
const releaseBaseUrl = args.get('release-base-url')
  || `https://github.com/gfishlab/MdBridge/releases/download/${tag}`;
const notes = args.get('notes') || `MDBridge ${tag}`;
const pubDate = args.get('pub-date') || new Date().toISOString();
const output = args.get('output') || join(repoRoot, 'release', 'latest.json');
const bundleDir = args.get('bundle-dir') || join(repoRoot, 'src-tauri', 'target', 'release', 'bundle');

const artifacts = findUpdaterArtifacts(bundleDir);
if (artifacts.length === 0) {
  throw new Error(`No updater artifacts found in ${relative(repoRoot, bundleDir)}. Run a signed Tauri build first.`);
}

const platforms = {};
for (const artifact of artifacts) {
  const signaturePath = `${artifact}.sig`;
  if (!existsSync(signaturePath)) {
    throw new Error(`Missing signature file for ${relative(repoRoot, artifact)}`);
  }

  const platformKeys = inferPlatformKeys(artifact);
  for (const platformKey of platformKeys) {
    platforms[platformKey] = {
      signature: readFileSync(signaturePath, 'utf8').trim(),
      url: `${releaseBaseUrl}/${encodeURIComponent(basename(artifact))}`,
    };
  }
}

const latest = {
  version,
  notes,
  pub_date: pubDate,
  platforms,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Wrote ${relative(repoRoot, output)}`);
for (const key of Object.keys(platforms).sort()) {
  console.log(`- ${key}: ${platforms[key].url}`);
}

function findUpdaterArtifacts(dir) {
  if (!existsSync(dir)) return [];

  const results = [];
  walk(dir, (file) => {
    if (
      file.endsWith('.app.tar.gz')
      || file.endsWith('.AppImage.tar.gz')
      || file.endsWith('.msi.zip')
      || file.endsWith('.nsis.zip')
    ) {
      results.push(file);
    }
  });
  return results.sort();
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, visit);
    } else if (entry.isFile()) {
      visit(path);
    }
  }
}

function inferPlatformKeys(artifact) {
  const file = basename(artifact);
  const arch = process.env.TAURI_TARGET_ARCH || nodeArchToTauriArch(process.arch);

  if (file.endsWith('.app.tar.gz')) {
    return [`darwin-${arch}-app`, `darwin-${arch}`];
  }
  if (file.endsWith('.AppImage.tar.gz')) {
    return [`linux-${arch}-appimage`, `linux-${arch}`];
  }
  if (file.endsWith('.msi.zip')) {
    return [`windows-${arch}-msi`, `windows-${arch}`];
  }
  if (file.endsWith('.nsis.zip')) {
    return [`windows-${arch}-nsis`, `windows-${arch}`];
  }

  throw new Error(`Unsupported updater artifact: ${file}`);
}

function nodeArchToTauriArch(arch) {
  if (arch === 'arm64') return 'aarch64';
  if (arch === 'x64') return 'x86_64';
  return arch;
}
