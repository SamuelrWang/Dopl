"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLASSES_REPLY_GUIDANCE = void 0;
/**
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY of the line an agent reads when its member is on glasses.
 *
 * A LEAF MODULE ON PURPOSE (no imports): `channel-source.ts` re-exports it for the MCP renderer, and
 * the Device SDK's default glasses profile (`src/features/device-sdk/delivery/default-profiles.ts`)
 * imports THIS file by path — the Next bundle cannot follow `channel-source.ts`'s `./narration.js`
 * import (Turbopack does not map `.js` → `.ts`; INVARIANTS §1). The desktop feeds its sessions the
 * same line (`dopl-desktop-app/main/message-source.js`), held byte-equal to this file by a desktop test.
 */
exports.GLASSES_REPLY_GUIDANCE = "They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). " +
    "Choices or structure: dopl_show (it reaches the lens). " +
    "Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.";
