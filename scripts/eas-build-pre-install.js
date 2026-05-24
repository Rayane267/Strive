#!/usr/bin/env node
// EAS Build pre-install hook
// Restaure `.env` à la racine du projet depuis le file secret `STRIVE_ENV_FILE`
// (uploadé via `eas env:create --type file`). Sans ça, react-native-dotenv
// au transform Babel ne trouve pas les clés Supabase/RC/Sentry/etc.
//
// Hors EAS Build (= local dev) : pas de var, on no-op proprement.

const fs = require('fs');
const path = require('path');

const SRC_VAR = 'STRIVE_ENV_FILE';
const TARGET = path.resolve(__dirname, '..', '.env');

const src = process.env[SRC_VAR];

if (!src) {
  if (process.env.EAS_BUILD === 'true') {
    console.error(
      `[pre-install] ❌ ${SRC_VAR} non défini. Upload .env via :\n` +
      `   eas env:create --scope project --environment production --name ${SRC_VAR} --type file --visibility secret --value ./.env`
    );
    process.exit(1);
  }
  console.log('[pre-install] not in EAS Build, skipping .env restore');
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.error(`[pre-install] ❌ Fichier secret introuvable: ${src}`);
  process.exit(1);
}

fs.copyFileSync(src, TARGET);
console.log(`[pre-install] ✅ .env restauré (${fs.statSync(TARGET).size} bytes)`);
