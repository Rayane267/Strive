#!/usr/bin/env node
// EAS Build post-install hook
// Synchronise CURRENT_PROJECT_VERSION entre l'app principale et ses
// extensions (Widget, Share Extension). EAS auto-incrémente la version
// de l'app principale mais pas celle des extensions, ce qui cause :
//   "The CFBundleVersion of an app extension must match its containing parent app"

const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('[post-install] Not macOS, skipping version sync');
  process.exit(0);
}

const pbxprojPath = path.resolve(__dirname, '..', 'ios', 'Strive.xcodeproj', 'project.pbxproj');

if (!fs.existsSync(pbxprojPath)) {
  console.log('[post-install] project.pbxproj not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(pbxprojPath, 'utf8');

// Find the app target's CURRENT_PROJECT_VERSION (first occurrence in
// a block that contains PRODUCT_BUNDLE_IDENTIFIER = com.striveapp.app;)
const appBlockRe = /buildSettings\s*=\s*\{[^}]*PRODUCT_BUNDLE_IDENTIFIER\s*=\s*com\.striveapp\.app;[^}]*\}/gs;
let appVersion = null;

for (const match of content.matchAll(appBlockRe)) {
  const versionMatch = match[0].match(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)/);
  if (versionMatch) {
    appVersion = versionMatch[1];
    break;
  }
}

if (!appVersion) {
  console.log('[post-install] Could not find app CURRENT_PROJECT_VERSION, skipping');
  process.exit(0);
}

console.log(`[post-install] App CURRENT_PROJECT_VERSION = ${appVersion}`);

// Update extension targets (widget + share) to match
const extensionIds = ['com.striveapp.app.widget', 'com.striveapp.app.share'];
let changed = false;

for (const bundleId of extensionIds) {
  const escapedId = bundleId.replace(/\./g, '\\.');
  const extBlockRe = new RegExp(
    `(buildSettings\\s*=\\s*\\{[^}]*PRODUCT_BUNDLE_IDENTIFIER\\s*=\\s*${escapedId};[^}]*?)CURRENT_PROJECT_VERSION\\s*=\\s*\\d+`,
    'gs'
  );
  const newContent = content.replace(extBlockRe, `$1CURRENT_PROJECT_VERSION = ${appVersion}`);
  if (newContent !== content) {
    content = newContent;
    changed = true;
    console.log(`[post-install] ✅ ${bundleId} → CURRENT_PROJECT_VERSION = ${appVersion}`);
  }
}

if (changed) {
  fs.writeFileSync(pbxprojPath, content, 'utf8');
  console.log('[post-install] ✅ project.pbxproj updated');
} else {
  console.log('[post-install] Extensions already in sync');
}
