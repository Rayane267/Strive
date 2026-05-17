// `.env` par défaut ; si `ENVFILE` est passé (build release), on lit ce fichier
// pour séparer dev vs prod. Exemple :
//   ENVFILE=.env.production npm run android:release
const envPath = process.env.ENVFILE || '.env';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: envPath,
      },
    ],
  ],
};
