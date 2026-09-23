import type { AgentToolProfile, ResolvedAgentToolProfile } from "../types";

/**
 * 🔒 **THE PROFILE A LAUNCH INTO THIS CHANNEL REALLY STARTS AT** — ruling B7's
 * narrowing, mirrored for the web tree (2026-09-13, F-692).
 *
 * ⚠ **THE DEFECT THIS CLOSES IS A CONTAINMENT CLAIM THAT WAS FALSE.** The Settings
 * tab's "Tool access" row rendered the STORED enum, so a shared channel whose
 * stored value is `full` printed **"Full access"** over a session the desktop runs
 * at `channel_agent` — `full` MINUS the shell. `constants.ts ›
 * UNRESOLVED_TOOL_PROFILE` already states the rule that makes that a bug: *"the
 * label is a containment claim, and 'Full access' over a session the desktop runs
 * `read_only` is a fail-open lie."* This is the same lie in the other direction —
 * the UI over-promising what it will run.
 *
 * ⚠ **IT IS A HAND COPY OF `dopl-desktop-app/main/tool-profiles.js ›
 * profileForChannel` AND `main/targeting-window.js › isSharedChannel`**, because
 * main is CommonJS and cannot import this tree. The drift is fenced by
 * `tool-profile-resolve-parity.test.ts`, which SLICES the desktop's own sentinel
 * block and runs it against this file over the full cross product.
 *
 * ⚠ **IT NARROWS AND IT CAN NEVER WIDEN.** The only pair it moves is `full` →
 * `channel_agent`, in a SHARED room. `read_only` and `dopl_only` are already
 * narrower than the fourth profile and come back untouched.
 *
 * ⚠ **AND IT IS A LAUNCH-TIME DERIVATION, NOT A SETTING.** Nothing writes
 * `channel_agent` to `channel_members.agent_tool_profile` — the stored enum is
 * still the three values of {@link AgentToolProfile}, which is why this returns
 * {@link ResolvedAgentToolProfile} and why no control on any surface may OFFER the
 * fourth value. A widened write enum would be rejected by the column's own CHECK.
 */
export function profileForChannel(
  profile: AgentToolProfile,
  shared: boolean
): ResolvedAgentToolProfile {
  return shared && profile === "full" ? "channel_agent" : profile;
}

/**
 * **IS THIS ROOM SHARED** — i.e. is there a second audience for what a session here
 * does? The fact behind {@link profileForChannel}, and the desktop's is
 * `targeting-window.js › isSharedChannel`.
 *
 * ⚠ **THE BODY MOVED TO `@/shared/tenancy/shared-room` ON 2026-09-17** (R-08,
 * F-513). It was the tree's only KIND-BLIND spelling of "is this room shared"
 * while three other sites gated on `kind === 'link'`; the ruling made it the one
 * that survives, so it became the shared module and this name stayed a re-export
 * — the channel-shaped alias — rather than moving thirteen importers to prove a
 * point. 🔒 ⚠ **AN ABSENT COUNT READS AS SHARED** and the argument for it is
 * unchanged and now stated once, there.
 */
export { isSharedRoom as isSharedChannel } from "@/shared/tenancy/shared-room";

/**
 * The caption under a narrowed "Tool access" row. ⚠ **SIX WORDS, NO PERIOD** — the
 * minimal-copy ruling (Samuel, 2026-08-19; INVARIANTS §5) allows a row a few-word
 * secondary line and nothing paragraph-shaped. It states the FACT and the RULE and
 * explains neither: why a shared channel has no shell is `tool-profiles.js`'s
 * header, not a settings row's job.
 */
export const SHARED_CHANNEL_TOOL_CAPTION =
  "Shared channel: agents run without a shell";
