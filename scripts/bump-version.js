#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Met à jour la version MARKETING de l'app dans les 3 sources natives/config
 * d'un seul coup :
 *   - iOS      : MARKETING_VERSION (toutes les configs) dans project.pbxproj
 *   - Android  : versionName dans android/app/build.gradle
 *   - Expo/EAS : version dans app.json
 *
 * Le NUMÉRO DE BUILD (CFBundleVersion / versionCode) n'est PAS touché : il est
 * géré à distance par EAS (`appVersionSource: remote`, `autoIncrement: true`).
 *
 * Usage :
 *   npm run bump-version 2.5.0
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('❌ Version invalide. Usage: npm run bump-version <x.y.z>  (ex: 2.5.0)');
  process.exit(1);
}

let changed = 0;

function patch(relPath, transform) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    console.warn(`⚠️  Introuvable, ignoré : ${relPath}`);
    return;
  }
  const before = fs.readFileSync(abs, 'utf8');
  const { content, count } = transform(before);
  if (count > 0 && content !== before) {
    fs.writeFileSync(abs, content);
    console.log(`✅ ${relPath} — ${count} remplacement(s)`);
    changed += count;
  } else {
    console.warn(`⚠️  Aucun remplacement dans ${relPath}`);
  }
}

// ── iOS : project.pbxproj (plusieurs targets/configs) ────────────────────────
const pbxDir = path.join(root, 'ios');
const xcodeproj = fs
  .readdirSync(pbxDir)
  .find(d => d.endsWith('.xcodeproj'));
if (xcodeproj) {
  patch(path.join('ios', xcodeproj, 'project.pbxproj'), src => {
    let count = 0;
    const content = src.replace(/MARKETING_VERSION = [^;]+;/g, () => {
      count++;
      return `MARKETING_VERSION = ${version};`;
    });
    return { content, count };
  });
} else {
  console.warn('⚠️  Aucun .xcodeproj trouvé dans ios/');
}

// ── Android : build.gradle ───────────────────────────────────────────────────
patch('android/app/build.gradle', src => {
  let count = 0;
  const content = src.replace(/versionName\s+"[^"]+"/, () => {
    count++;
    return `versionName "${version}"`;
  });
  return { content, count };
});

// ── Expo/EAS : app.json ──────────────────────────────────────────────────────
patch('app.json', src => {
  const json = JSON.parse(src);
  const had = json.version !== version;
  json.version = version;
  // 2 espaces d'indentation + newline final, comme le fichier existant.
  return { content: JSON.stringify(json, null, 2) + '\n', count: had ? 1 : 0 };
});

if (changed === 0) {
  console.error('\n❌ Rien n’a été modifié — vérifie les chemins.');
  process.exit(1);
}

console.log(`\n🎉 Version marketing mise à jour → ${version}`);
console.log('ℹ️  Le numéro de build reste géré par EAS (autoIncrement).');
