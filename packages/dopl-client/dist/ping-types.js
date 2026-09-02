"use strict";
/**
 * THE "NEEDS YOU" SIGNAL's types — an agent telling exactly ONE recipient that
 * it is done, has a question, or is blocked (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ Their own module, `direction-types.ts`'s arrangement and reason:
 * `channel-types.ts` is at the 500-line cap and these describe a MAILBOX rather
 * than a channel.
 *
 * ⚠ THEY ARE A HAND MIRROR of `src/features/channels/types-ping.ts`, which is
 * where every rule about them is STATED. Nothing here may restate one — a rule
 * in two places drifts in one of them, and you cannot tell which from outside.
 */
Object.defineProperty(exports, "__esModule", { value: true });
