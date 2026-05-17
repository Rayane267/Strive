module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['jest-setup.js', '**/__tests__/**/*.{ts,tsx,js}', '**/*.test.{ts,tsx,js}'],
      env: { jest: true, node: true },
    },
  ],
};
