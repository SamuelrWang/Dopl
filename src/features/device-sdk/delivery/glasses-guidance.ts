/**
 * THE DEVICE SDK'S GLASSES REPLY LINE — the `prompt_append` of the default glasses profile.
 *
 * OWNED HERE, not imported: the Device SDK server must not reach into the app's MCP package
 * (`packages/mcp-server`) by relative path — that is the coupling the SDK split removes (Plan
 * §7.2, W0.4; the `no-restricted-syntax` packages-src fence in `eslint.config.mjs` holds it).
 * The text is still the SAME LINE the app shows: `glasses-guidance.test.ts` reads the MCP leaf
 * (`packages/mcp-server/src/tools/glasses-reply-guidance.ts`) as a file and fails on any drift,
 * the same way the desktop's copy (`dopl-desktop-app/main/message-source.js`) is held.
 */
export const GLASSES_REPLY_GUIDANCE =
  "They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). " +
  "Choices or structure: dopl_show (it reaches the lens). " +
  "Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.";
