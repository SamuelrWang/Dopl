/**
 * The message axis's word type, derived from `schema-launch-modes.ts`. The tool axis is a permission
 * level (`launch-selection.ts › PermissionLevel`) that each runtime applies in its own settings.
 */

import type { LAUNCH_MESSAGE_MODES } from "../schema-launch-modes";

/** Axis B: what crosses between the two machines; Dopl's own axis on every runtime. */
export type MessageMode = (typeof LAUNCH_MESSAGE_MODES)[number];
