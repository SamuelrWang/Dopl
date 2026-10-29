"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLASSES_REPLY_GUIDANCE = void 0;
/**
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY of the line an agent reads when its member is on glasses.
 *
 * A LEAF MODULE ON PURPOSE (no imports): `channel-source.ts` re-exports it for the MCP renderer, and
 * app tests import it by path (the Next bundle cannot follow `channel-source.ts`'s `./narration.js`
 * import; Turbopack does not map `.js` → `.ts`; INVARIANTS §1). Two copies are held byte-equal to
 * this file by tests that read it as a file: the desktop's (`dopl-desktop-app/main/message-source.js`)
 * and the Device SDK's default glasses profile (`src/features/device-sdk/delivery/glasses-guidance.ts`,
 * which no longer imports this package: SDK split boundary, Plan §7.2).
 */
exports.GLASSES_REPLY_GUIDANCE = "They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). " +
    "Choices or structure: dopl_show (it reaches the lens). " +
    "Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.";
