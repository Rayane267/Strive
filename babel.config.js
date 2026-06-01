// `.env` par défaut ; si `ENVFILE` est passé (build release), on lit ce fichier
// pour séparer dev vs prod. Exemple :
//   ENVFILE=.env.production npm run android:release
const envPath = process.env.ENVFILE || '.env';

module.exports = function (api) {
  // En env `test` (Jest), on ne charge pas react-native-dotenv : il inline les
  // valeurs `@env` au transform à partir d'un `.env`, ce qui est non
  // déterministe en CI. Les tests résolvent `@env` vers `__mocks__/env.js` via
  // le `moduleNameMapper` de jest.config.js.
  const isTest = api.env('test');

  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: isTest
      ? []
      : [
          [
            'module:react-native-dotenv',
            {
              moduleName: '@env',
              path: envPath,
            },
          ],
        ],
  };
};
