module.exports = {
  root: true,
  extends: '@react-native',
  // Le site Next.js a sa propre toolchain — les règles React Native n'y ont pas de sens.
  ignorePatterns: ['web/'],
  overrides: [
    {
      files: ['jest-setup.js', '**/__tests__/**/*.{ts,tsx,js}', '**/*.test.{ts,tsx,js}'],
      env: { jest: true, node: true },
    },
  ],
};
