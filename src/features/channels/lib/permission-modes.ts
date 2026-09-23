/**
 * The two permission axes' word types, derived from `schema-launch-modes.ts`. A runtime's own Axis-A
 * words come from its descriptor (`runtime-capability.ts › toolModeOptions`); main validates writes.
 */

import type { LAUNCH_MESSAGE_MODES, LAUNCH_TOOL_MODES } from "../schema-launch-modes";

/** Axis A: what the agent may do — any registered runtime's word (the union). */
export type ToolMode = (typeof LAUNCH_TOOL_MODES)[number];

/** Axis B: what crosses between the two machines; Dopl's own axis on every runtime. */
export type MessageMode = (typeof LAUNCH_MESSAGE_MODES)[number];

export interface PermissionPreset {
  tools: ToolMode;
  messages: MessageMode;
}
