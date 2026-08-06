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

// `no-redeclare` — THE RULE F-143 EARNED, added 2026-08-05 (F-146).
//
// It is off in `eslint:recommended`'s absence and this config takes no preset, so a second
// `function nameForSession(...)` in one file was silently legal: the later declaration won,
// the earlier one became unreachable, and the file read as though both were live. That is
// exactly what shipped in F-143 and it cost a real debugging round. `max-lines` cannot catch
// it — a duplicate makes a file BIGGER, so the cap reads it as ordinary growth.
//
// `builtinGlobals: false` on purpose. These files run with the `globals.node` +
// `globals.browser` union declared below, and that union legitimately contains names a
// main-process module may shadow (`name`, `status`, `origin`, `close`, `event`, `length`).
// Flagging those would be a rename wave with no defect behind it; the defect this rule is
// here for is a duplicate declaration inside one file.
const NO_REDECLARE = ['error', { builtinGlobals: false }];

module.exports = [
  { ignores: ['renderer/app/**', 'node_modules/**', 'dist/**', 'build/**'] },

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
      'no-redeclare': NO_REDECLARE,
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
      'no-redeclare': NO_REDECLARE,
    },
  },
];
