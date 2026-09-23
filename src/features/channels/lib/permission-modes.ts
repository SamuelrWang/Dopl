/**
 * THE TWO PERMISSION AXES' WORD TYPES — types only, derived from the one declaration of each
 * vocabulary (`schema-launch-modes.ts`, narrowest first). The desktop re-validates every write and
 * the SELECTED runtime's descriptor owns Axis A's words (`runtime-capability.ts ›
 * toolModeOptions`); nothing here coerces or defaults a value.
 */

import type { LAUNCH_MESSAGE_MODES, LAUNCH_TOOL_MODES } from "../schema-launch-modes";

/** AXIS A — what this machine's agent may DO, in Dopl's default-runtime words. */
export type ToolMode = (typeof LAUNCH_TOOL_MODES)[number];

/** AXIS B — what CROSSES between the two machines. Dopl's own axis, on every runtime. */
export type MessageMode = (typeof LAUNCH_MESSAGE_MODES)[number];

export interface PermissionPreset {
  tools: ToolMode;
  messages: MessageMode;
}
