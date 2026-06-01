module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest-setup.js'],
  // La preset RN ignore tout node_modules sauf (jest-)?react-native et @react-native.
  // On ajoute les paquets ESM utilisés par l'app (navigation, Firebase, Google Sign-In,
  // Sentry, Apple auth) pour que Babel les transforme avant exécution des tests.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@sentry|@react-native-firebase|@react-native-google-signin|@invertase|react-native-.*)/)',
  ],
  // Le plugin react-native-dotenv est désactivé en test (babel.config.js) ;
  // on résout `@env` vers un mock déterministe.
  moduleNameMapper: {
    '^@env$': '<rootDir>/__mocks__/env.js',
  },
};
