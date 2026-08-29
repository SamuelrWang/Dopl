"use strict";
/**
 * THE CHANNEL INFO CARD, on the SDK side.
 *
 * ⚠ ITS OWN MODULE for the reason `launch-types.ts` is one: `channel-types.ts`
 * hit the 500-line cap, and the card is a self-contained contract with its own
 * server twin (`src/features/channels/info-card.ts`) rather than another field
 * of the channel row. ⚠ RE-EXPORTED FROM `channel-types.ts` unchanged, so no
 * consumer moved.
 *
 * ⚠ HAND-MIRRORED, and no drift gate covers the pair. The server module is the
 * authority on bounds (12 rows, 40-char labels, 200-char values, a 3.5 KB
 * serialized ceiling under a 4 KiB DB CHECK); this side declares the SHAPE only,
 * because a second statement of the bounds is a second thing to drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
