import type { IdentityField } from "../client/types";

/**
 * What an operator may change for one launch — never written back to the identity. The one producer
 * is `channels/components/use-agent-launch-run.ts › launchOverridesOf`; main re-validates the whole
 * object (`main/identity-resolve.js › narrowOverrides`) before any of it reaches a prompt (F-281).
 */

/** The column's own bound (`../schema.ts › MAX_INSTRUCTIONS_CHARS`) — never a smaller one (F-287). */
export const MAX_OVERRIDE_INSTRUCTIONS_CHARS = 32_768;

/** Absent is the only spelling of "no override" on every key. */
export interface IdentityLaunchOverrides {
  /** A model id; absent ⇒ the identity's model, else the runtime default. */
  model?: string;
  /** Replaces the identity's instructions for this spawn; prose, so no charset rule (main re-bounds). */
  instructions?: string;
  /** Replaces the identity's fields for this spawn — never merged. No renderer producer today. */
  fields?: IdentityField[];
}
