// Mock de `@env` (react-native-dotenv) pour les tests.
// En env `test`, le plugin dotenv est désactivé (voir babel.config.js) et Jest
// résout `@env` vers ce module via `moduleNameMapper`. Valeurs factices, non
// secrètes : aucun service réseau réel n'est appelé (fetch est mocké).
module.exports = {
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  PUBLIC_SUPABASE_KEY: 'test-anon-key',
  TOMTOM_API_KEY: 'test-tomtom-key',
  REVENUECAT_API_KEY_ANDROID: 'test-rc-android',
  REVENUECAT_API_KEY_IOS: 'test-rc-ios',
  SENTRY_DSN: '',
  GOOGLE_WEB_CLIENT_ID: 'test-google-web',
  GOOGLE_IOS_CLIENT_ID: 'test-google-ios',
};
