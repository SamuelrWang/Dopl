/**
 * DOPL'S DEFAULT CONTEXT PROFILES (C5) — one per device kind, plus model-tuned defaults.
 *
 * A profile is GUIDANCE for the developer's agent (`prompt_append`, `output`) and the LIMITS Dopl
 * enforces (D3: truncate / send_to / callback — never a rewrite). Glasses mean concise replies, a
 * laptop means long ones (Samuel, 2026-10-27). A project overrides any of these with a
 * `context_profiles` row (`resolve-profile.ts`).
 *
 * 🔒 THE GLASSES TEXT IS NOT RESTATED HERE: it is `GLASSES_REPLY_GUIDANCE`, imported from the MCP
 * server's leaf module, the one copy the MCP renderer and the desktop also use.
 */
import { GLASSES_REPLY_GUIDANCE } from "../../../../packages/mcp-server/src/tools/glasses-reply-guidance";
import type { ContextProfile, DeviceKind } from "../types";

/** Every Dopl default is version 1 until its text changes; events record `profile_id` + version. */
const V = 1;
/** C7: T3 allowed (confirmation configurable per project); T4 never `none`, denied outright until a project configures confirmation. */
const SAFE_CONFIRMATION = { T4: "deny" } as const;

export const DOPL_KIND_PROFILES: Record<DeviceKind, ContextProfile> = {
  glasses: {
    id: "glasses-default",
    version: V,
    match: { kind: "glasses" },
    prompt_append: GLASSES_REPLY_GUIDANCE,
    output: { max_lines: 5, max_chars: 300, format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*", "capture.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: { send_to: "phone" },
  },
  phone: {
    id: "phone-default",
    version: V,
    match: { kind: "phone" },
    prompt_append: "They are on their phone: keep replies short and scannable, a few short paragraphs at most.",
    output: { max_chars: 2000, format: "markdown", markdown: true },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*", "capture.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
  desktop: {
    id: "desktop-default",
    version: V,
    match: { kind: "desktop" },
    prompt_append:
      "They are at their computer with a full screen and keyboard: long, detailed replies are fine, including markdown, code and tables.",
    output: { format: "markdown", markdown: true },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*", "capture.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
  watch: {
    id: "watch-default",
    version: V,
    match: { kind: "watch" },
    prompt_append: "They are on a watch: at most two very short plain lines.",
    output: { max_lines: 2, max_chars: 100, format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: { send_to: "phone" },
  },
  home_hub: {
    id: "home_hub-default",
    version: V,
    match: { kind: "home_hub" },
    prompt_append: "They are near a home hub that may read the reply aloud: a few short plain sentences.",
    output: { max_lines: 4, max_chars: 400, format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*", "act.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
  home_device: {
    id: "home_device-default",
    version: V,
    match: { kind: "home_device" },
    prompt_append: "This is a home device with no screen: act or report state; do not send prose to it.",
    output: { format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "act.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
  vehicle: {
    id: "vehicle-default",
    version: V,
    match: { kind: "vehicle" },
    prompt_append: "They are driving: one short spoken sentence; never ask them to read, type or look at a screen.",
    output: { max_lines: 1, max_chars: 120, format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*", "act.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
  robot: {
    id: "robot-default",
    version: V,
    match: { kind: "robot" },
    prompt_append: "This is a robot: send capability calls, not prose.",
    output: { format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "capture.*", "act.*", "act.motion.*"],
    confirmation: { ...SAFE_CONFIRMATION },
    overflow: "truncate",
  },
};

/**
 * Model-tuned Dopl defaults: checked before the per-kind one. The G2 keeps the glasses text and
 * limits; its own lens limits come from the adapter descriptor at enforcement time.
 */
export const DOPL_MODEL_PROFILES: readonly ContextProfile[] = [
  {
    ...DOPL_KIND_PROFILES.glasses,
    id: "even_g2-default",
    match: { kind: "glasses", model: "even_g2" },
  },
];

