"use strict";
/**
 * ARTIFACT types — the after-the-fact fold of a run of main-room messages
 * (#1220, accepted #1222).
 *
 * ⚠ **ITS OWN MODULE FOR `escalation-types.ts` / `launch-types.ts` / `info-card-types.ts`'s
 * REASON, WHICH IS THE ONLY REASON THIS PACKAGE SPLITS A TYPE FILE**: `channel-types.ts`
 * is at the 500-line cap (§1; the `size-check` CI job, and `max-lines` in
 * `eslint.config.mjs`). The seam is a REASON TO CHANGE, not a line count — artifacts are
 * one feature's shapes, they arrived together and they change together.
 *
 * ⚠ **RE-EXPORTED UNCHANGED FROM `channel-types.ts`, SO NO CONSUMER MOVED.** Every name
 * here is still `import type { … } from "@dopl/client"`, which is the same discipline the
 * three modules above already follow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
