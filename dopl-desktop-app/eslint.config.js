// Minimal flat ESLint config for the Dopl desktop app (Electron main process).
//
// The desktop app is a CommonJS Node/Electron codebase (require/module.exports,
// node globals). It takes NO §2 file-size exceptions, so the load-bearing rule
// here is `max-lines` at 500 — the ENGINEERING.md §2 hard cap — which makes a
// future split regression fail `npm run lint` instead of silently reappearing.
// The rest is left deliberately light so this config never flags the existing,
// E2E-verified main-process code. node_modules / dist / build are generated.

const globals = require('globals');

const MAX_LINES = ['error', { max: 500, skipBlankLines: false, skipComments: false }];

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'build/**'] },

  // CommonJS main process + scripts + preload/renderer helpers.
  {
    files: ['main/**/*.js', 'scripts/**/*.js', 'renderer/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'max-lines': MAX_LINES,
    },
  },

  // ESM test files (`.mjs`) — the source-extraction truth tables.
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'max-lines': MAX_LINES,
    },
  },
];
