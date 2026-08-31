"use strict";
/**
 * STRUCTURED ESCALATION types — their own module (2026-08-31), for the reason
 * `launch-types.ts` is one: `channel-types.ts` is at the 500-line cap, and these
 * describe a payload rather than a channel.
 *
 * ⚠ THEY ARE A HAND MIRROR of `src/features/channels/escalation.ts`, which is
 * where the shape, the caps and every rule about them are STATED. Nothing here
 * may restate a rule — a rule in two places drifts in one of them, and you
 * cannot tell which from the outside.
 */
Object.defineProperty(exports, "__esModule", { value: true });
