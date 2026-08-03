// Identical to the web app's postcss.config.mjs — Tailwind v4 is CSS-first, so
// this is the whole build config (there is no tailwind.config.*; the theme
// lives in src/styles/tokens.css). Vite reads this file natively.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
