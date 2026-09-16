import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Règle React 19 qui remonte 4 occurrences préexistantes, toutes
      // légitimes : tirage aléatoire au montage pour éviter un mismatch
      // d'hydratation (ScanShowcase) et chargements `async` dont les setState
      // ne sont pas synchrones (console /admin). Gardée en warning le temps
      // d'un vrai passage sur ces composants, plutôt que de les refactorer
      // à la va-vite.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
