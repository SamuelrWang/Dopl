/**
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY of the line an agent reads when its member is on glasses.
 *
 * A LEAF MODULE ON PURPOSE (no imports): `channel-source.ts` re-exports it for the MCP renderer, and
 * the Device SDK's default glasses profile (`src/features/device-sdk/delivery/default-profiles.ts`)
 * imports THIS file by path — the Next bundle cannot follow `channel-source.ts`'s `./narration.js`
 * import (Turbopack does not map `.js` → `.ts`; INVARIANTS §1). The desktop feeds its sessions the
 * same line (`dopl-desktop-app/main/message-source.js`), held byte-equal to this file by a desktop test.
 */
export declare const GLASSES_REPLY_GUIDANCE: string;
