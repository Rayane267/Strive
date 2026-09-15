#!/usr/bin/env node
/**
 * Les libellés que le NATIF affiche, générés depuis les fichiers de langue.
 *
 * ── LE PROBLÈME QUE ÇA RÉSOUT ─────────────────────────────────────────────
 * La Live Activity, CarPlay, les intentions Siri et la bulle Android ne
 * peuvent pas appeler i18next : ils tournent dans des processus qui n'ont
 * jamais chargé JavaScript. Chacun portait donc ses propres phrases, en dur,
 * et en DEUX langues seulement — un chauffeur espagnol lisait « Analyse… » sur
 * son écran verrouillé.
 *
 * Plutôt que de recopier les traductions dans du Swift et du XML, on les lit
 * là où elles vivent déjà : `src/locales/<langue>.json`, clé `native`. Une
 * phrase ne s'écrit qu'une fois, à côté de ses voisines, et un traducteur n'a
 * jamais à ouvrir un fichier de code.
 *
 * ── CE QUI EST ÉCRIT ──────────────────────────────────────────────────────
 *   ios/Strive/LiveActivity/StriveActivityAttributes.swift
 *     le bloc entre `// <generated:native-strings>` et sa fermeture. Ce fichier
 *     est compilé par les TROIS cibles iOS (app, widget, share extension), ce
 *     qui évite d'avoir à câbler des ressources localisées dans chacune.
 *
 *   android/app/src/main/res/values-xx/strings.xml
 *     Android résout lui-même la bonne ressource à partir du Locale posé par
 *     `FloatingBubbleService.setAppLanguage` : il n'y a rien à écrire en
 *     Kotlin, le fichier suffit. Les clés que ce script ne connaît pas
 *     (`expo_runtime_version`, posée par Expo) sont CONSERVÉES telles quelles.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   npm run gen:native              réécrit les fichiers
 *   npm run gen:native -- --check   n'écrit rien, sort en 1 si ça a dérivé
 *
 * Le mode `--check` est fait pour la CI : il attrape la phrase ajoutée dans
 * une seule langue, et le fichier généré modifié à la main.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['fr', 'en', 'es', 'pt', 'nl', 'de', 'it'];

/** Le français fait référence : c'est lui qui liste les clés attendues. */
const REFERENCE = 'fr';

const SWIFT = 'ios/Strive/LiveActivity/StriveActivityAttributes.swift';
const OPEN = '  // <generated:native-strings>';
const CLOSE = '  // </generated:native-strings>';

/**
 * Nom de ressource Android → clé `native`.
 *
 * Deux clés servent des deux côtés (`noOffer`, `sessionRequired`) : la même
 * phrase, un seul endroit où la corriger. Les autres n'existent que dans la
 * bulle et ses notifications, qui n'ont pas d'équivalent iOS.
 */
const ANDROID = {
  app_name: 'appName',
  accessibility_service_description: 'accessibilityDescription',
  scanner_not_a_ride: 'noOffer',
  scanner_session_required_bubble: 'bubbleGoOnline',
  scanner_session_required_title: 'sessionRequired',
  scanner_session_required_body: 'bubbleSessionBody',
  scanner_notif_active_title: 'bubbleNotifTitle',
  scanner_notif_active_body: 'bubbleNotifBody',
  scanner_notif_online: 'bubbleOnline',
  scanner_ride_accept: 'bubbleRideTaken',
  scanner_ride_decline: 'bubbleRideDeclined',
  scanner_quota_reached: 'bubbleQuota',
  scanner_quota_reached_free: 'bubbleQuotaFree',
};

/** `values` sans suffixe = le français, défaut du projet Android. */
const VALUES_DIR = {
  fr: 'values', en: 'values-en', es: 'values-es',
  pt: 'values-pt', nl: 'values-nl', de: 'values-de', it: 'values-it',
};

const check = process.argv.includes('--check');
const problems = [];
const wrote = [];

// ── Lecture de la source ────────────────────────────────────────────────────
const native = {};
for (const lang of LANGS) {
  const p = join(ROOT, 'src/locales', `${lang}.json`);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  if (!json.native) problems.push(`${lang}.json : pas de bloc "native"`);
  native[lang] = json.native ?? {};
}

const keys = Object.keys(native[REFERENCE]);
for (const lang of LANGS) {
  for (const k of keys) {
    if (typeof native[lang][k] !== 'string' || native[lang][k] === '') {
      problems.push(`native.${k} manque en « ${lang} »`);
    }
  }
  for (const k of Object.keys(native[lang])) {
    if (!keys.includes(k)) problems.push(`native.${k} existe en « ${lang} » mais pas en « ${REFERENCE} »`);
  }
}

// ── Swift ───────────────────────────────────────────────────────────────────
// `\` d'abord : l'échapper après aurait doublé les antislashs des autres
// séquences. Le saut de ligne devient `\n` — Swift ne les accepte pas crus
// dans un littéral, et une phrase en deux lignes existe (l'écran de partage).
const swiftEscape = s =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const swiftRows = keys.map(k => {
  const pairs = LANGS.map(l => `"${l}": "${swiftEscape(native[l][k] ?? '')}"`).join(', ');
  return `    "${k}": [${pairs}],`;
});
const swiftBlock = [
  OPEN,
  '  // ⚠️ BLOC GÉNÉRÉ — ne pas éditer à la main.',
  '  //',
  '  // La source est `src/locales/<langue>.json`, clé `native` : le MÊME',
  "  // fichier que celui où vivent les traductions de l'app. Une phrase ne",
  "  // s'écrit donc qu'une fois, au même endroit que ses voisines, et un",
  "  // traducteur n'a jamais à ouvrir du Swift.",
  '  //',
  '  //     npm run gen:native          régénère ce bloc et les XML Android',
  "  //     npm run gen:native -- --check   échoue si l'un des deux a dérivé",
  '',
  '  static let table: [String: [String: String]] = [',
  ...swiftRows,
  '  ]',
  CLOSE,
].join('\n');

{
  const p = join(ROOT, SWIFT);
  const src = readFileSync(p, 'utf8');
  const i = src.indexOf(OPEN);
  const j = src.indexOf(CLOSE);
  if (i < 0 || j < 0) {
    problems.push(`${SWIFT} : bornes <generated:native-strings> introuvables`);
  } else {
    const next = src.slice(0, i) + swiftBlock + src.slice(j + CLOSE.length);
    if (next !== src) {
      if (check) problems.push(`${SWIFT} a dérivé de src/locales`);
      else { writeFileSync(p, next, 'utf8'); wrote.push(SWIFT); }
    }
  }
}

// ── Android ─────────────────────────────────────────────────────────────────
// L'apostrophe et le guillemet DOIVENT être échappés dans une ressource
// Android, sinon aapt refuse le build — c'est la faute la plus fréquente sur
// un texte français, et elle ne se voit qu'à la compilation.
const xmlEscape = s =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');

for (const lang of LANGS) {
  const rel = `android/app/src/main/res/${VALUES_DIR[lang]}/strings.xml`;
  const p = join(ROOT, rel);

  // Ce que le script ne connaît pas reste : `expo_runtime_version` est posée
  // par Expo, la régénérer l'effacerait à chaque build.
  const kept = [];
  if (existsSync(p)) {
    const prev = readFileSync(p, 'utf8');
    for (const m of prev.matchAll(/^\s*<string name="([^"]+)"[^>]*>[\s\S]*?<\/string>\s*$/gm)) {
      if (!(m[1] in ANDROID)) kept.push(m[0].trim());
    }
  }

  const lines = [
    '<resources>',
    '  <!-- ⚠️ FICHIER GÉNÉRÉ — source : src/locales/' + lang + '.json, clé `native`.',
    '       npm run gen:native. Les clés inconnues du script sont conservées. -->',
  ];
  for (const [xmlName, key] of Object.entries(ANDROID)) {
    const v = native[lang][key];
    if (v == null) continue;
    lines.push(`  <string name="${xmlName}">${xmlEscape(v)}</string>`);
  }
  for (const k of kept) lines.push('  ' + k);
  lines.push('</resources>');
  const next = lines.join('\n') + '\n';

  const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (prev !== next) {
    if (check) problems.push(`${rel} a dérivé de src/locales`);
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, next, 'utf8');
      wrote.push(rel);
    }
  }
}

// ── Verdict ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n${problems.length} problème(s) :`);
  for (const p of problems) console.error('  ✗ ' + p);
  console.error(check ? '\nLancez `npm run gen:native`.\n' : '');
  process.exit(1);
}
console.log(
  check
    ? `✓ ${keys.length} libellés × ${LANGS.length} langues — natif à jour`
    : wrote.length
      ? `✓ ${keys.length} libellés × ${LANGS.length} langues\n` + wrote.map(w => '  → ' + w).join('\n')
      : `✓ ${keys.length} libellés × ${LANGS.length} langues — rien à changer`,
);
