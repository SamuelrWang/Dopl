"use strict";
/**
 * LAUNCH-OVER-MCP types — asking an operator's OWN desktop to start an agent.
 *
 * ⚠ SPLIT OUT OF `channel-types.ts` on 2026-08-22, at the 500-line cap (that
 * file measured 505 with these in it). Re-exported from `index.ts` exactly as
 * before, so no consumer import changed.
 *
 * ⚠ THE ONE THING TO CARRY AWAY: **a directive is a REQUEST, not a command, and
 * it is NOT A MESSAGE.** It never touches `channel_messages` (the loop brake and
 * transcript purity), so it has no `seq` and can never end an `await`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
