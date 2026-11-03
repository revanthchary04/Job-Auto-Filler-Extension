/**
 * Build a Chrome Web Store / sideload zip: dist/originfill-<version>.zip
 * Contains only the files the extension needs (no tests, node_modules or docs).
 *
 *   npm run package
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', '_locales', 'assets', 'background', 'content', 'popup', 'settings', 'storage', 'utils', 'LICENSE'];

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const distDir = path.join(ROOT, 'dist');
const zipPath = path.join(distDir, `originfill-${version}.zip`);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

if (process.platform === 'win32') {
  const items = INCLUDE.map(p => `'${path.join(ROOT, p)}'`).join(',');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${items} -DestinationPath '${zipPath}'`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', zipPath, ...INCLUDE, '-x', '*.DS_Store'], { cwd: ROOT, stdio: 'inherit' });
}

const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`Built ${path.relative(ROOT, zipPath)} (${sizeKb} KB)`);
