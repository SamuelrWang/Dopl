// The LAUNCH SPLASH — `renderer/loading.html`.
//
// It was a centred logo over a spinning ring: the first thing every user sees
// on every launch, and the exact thing Samuel's checklist names first ("no
// spinning loaders, everything should have skeletons" —
// docs/LAUNCH-READINESS-ROADMAP.md §5). It is now a SHELL SKELETON: the real
// geometry of the window that replaces it (dark workspace rail, grey sidebar,
// floating white page card), so the swap to the loaded app is a content
// change rather than a layout change.
//
// Text assertions on a standalone HTML file, in the discipline
// session-chrome.test.mjs established for the session window's markup. Two
// things are pinned and both are behavioural, not cosmetic: no spinner may
// come back, and the geometry must stay in step with the shell tokens in
// src/app/globals.css that this file copies (it cannot import them — it is a
// file:// document with no Tailwind and no globals.css).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(
  fileURLToPath(new URL("../renderer/loading.html", import.meta.url)),
  "utf8"
);

test("no spinner survives — not the class, not the rotation keyframe", () => {
  assert.equal(/\.spinner\b/.test(html), false, "the .spinner rule is gone");
  assert.equal(
    /rotate\(360deg\)/.test(html),
    false,
    "nothing rotates on the launch screen"
  );
  assert.equal(/animation:\s*spin\b/.test(html), false);
});

test("the one animation left is the shared skeleton pulse", () => {
  // Same shape as Tailwind's `animate-pulse`, which is what
  // src/shared/ui/skeleton.tsx uses — the splash and the app must not read
  // as two different loading languages.
  assert.match(html, /@keyframes ghost/);
  assert.match(html, /50%\s*\{\s*opacity:\s*0\.5;\s*\}/);
  assert.match(html, /animation:\s*ghost 2s/);
});

test("reduced-motion holds the skeleton still instead of slowing a spin", () => {
  assert.match(
    html,
    /@media \(prefers-reduced-motion: reduce\) \{ \.g \{ animation: none; \} \}/
  );
});

test("it renders the app's real shell geometry, not a centred logo", () => {
  // Copied from src/app/globals.css: --shell-rail-w 62px, --shell-sidebar-w
  // 204px, the .page-float 14px radius and its 7/8/9/8 margins.
  assert.match(html, /width: 62px/, "workspace rail width");
  assert.match(html, /width: 204px/, "sidebar width");
  assert.match(html, /border-radius: 14px/, "page-float radius");
  assert.match(html, /margin: 7px 8px 9px 8px/, "page-float margins");
  assert.match(html, /height: 52px/, "the 52px page header strip");
});

test("it uses the token palette the shell paints with", () => {
  assert.match(html, /#2c3640/, "--rail");
  assert.match(html, /#f1f2f4/, "shell surface behind the sidebar");
  assert.match(html, /#fbfcfd/, "--panel-surface, the page card");
});

test("the ghost blocks are decorative; one live region does the announcing", () => {
  assert.match(html, /class="shell" aria-hidden="true"/);
  const live = html.match(/role="status"[^>]*/g) ?? [];
  assert.equal(live.length, 1, "exactly one live region");
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Opening Dopl/);
});

test("it stays a static local document — no script, no remote fetch", () => {
  assert.equal(/<script/i.test(html), false);
  assert.equal(/https?:\/\//i.test(html), false);
});
