"use client";

/**
 * Channels v2 — the Settings tab's AGENT half: its ROW VOCABULARY, and nothing
 * that reads, writes or decides anything.
 *
 * ⚠ PURE MOVE OUT OF `settings-agent.tsx` (2026-08-26). Not a redesign: every
 * recipe and every string below is the one that file rendered, byte for byte. It
 * moved because that file had reached the 500-line cap (INVARIANTS §1 — "a file
 * at 500 cannot absorb a comment") and the posture warning had to land in it; the
 * three presentational helpers and the one heading string are the part with the
 * fewest reasons to change, so they are the part that leaves.
 *
 * ⚠ THE MINIMAL-COPY RULING LIVES IN `settings-agent.tsx`'s DOCBLOCK AND STILL
 * GOVERNS EVERY ROW BUILT FROM THESE (Samuel, 2026-08-19; INVARIANTS §5): a row
 * on this tab is a NAME and a CONTROL, plus at most a few-word secondary line,
 * and no paragraph-style `text-caption` block anywhere. There is deliberately no
 * recipe here for a third line — see the `Note` tombstone below.
 *
 * ⚠ `settings-desktop-rows.tsx` STILL TAKES `SettingName` / `GroupLabel` AS
 * PROPS, unchanged. They were props because these lived in the host; they could
 * be imports now, but rewiring that is a second change with its own review, and
 * this move is deliberately behaviour-free.
 */

import type { ReactNode } from "react";
import type { AgentToolProfile } from "../../types";

/**
 * WHAT EACH TOOL PROFILE MEANS. ⚠ Source of truth is
 * `dopl-desktop-app/main/tool-profiles.js` — read its header before touching a
 * line here. Each rendered line is a claim about CONTAINMENT, so it is bounded
 * by the same rules the long sentences were, at a FIFTH of the length.
 *
 * `full` — no `--tools` bound, no `--allowedTools`, no scoped `--settings`, and
 * specifically NO `--strict-mcp-config`: the operator's OWN connected MCP servers
 * load alongside Dopl's and their global `permissions.allow` keeps applying.
 * That is the PRODUCT. The copy's job is to INFORM, not to warn.
 *
 * `dopl_only` — local read built-ins + WebFetch/WebSearch + NON-ADMIN Dopl tools,
 * pre-approved by name so they work headless. ⚠ Not "full minus danger" — it is
 * not more dangerous than `full` and is a legitimate first choice.
 * `dopl_channel` is excluded AND denied by name, so its reply routes back through
 * the approve-out gate rather than posting itself.
 *
 * `read_only` — local read built-ins only. The whole Dopl MCP server is denied by
 * prefix, and so is the web, so it is the one profile with no outbound channel.
 *
 * ⚠ Do NOT add "and a few destructive tools are always denied" to the `full`
 * line. `UNIVERSAL_HARD_DENY` is exactly the Dopl ADMIN + RETIRED tools, while
 * the SDK lane's `SESSION_HARD_DENY` is BROADER on purpose — so a generalizing
 * sentence is true on one lane and wrong on the other. These describe what each
 * profile GRANTS and promise nothing about what is withheld. That rule survived
 * the shortening: `full` still NAMES the connected apps, and no line ranks a
 * restricted profile as the safe or recommended answer.
 *
 * ⚠ THESE ARE THE ONLY DESCRIPTIONS LEFT ON THE TAB (Samuel, 2026-08-19 —
 * minimal copy). Tools keeps one because it is the CONTAINMENT pick; Permissions
 * and Sends render their option labels alone and keep their per-option
 * descriptions inside the `SelectMenu` dropdown, where a person reads them while
 * choosing. **≤5 words each, no trailing period.** The full sentences these
 * replaced are directly above — as a comment, deliberately.
 *
 * ⚠ SECOND PURE MOVE OUT OF `settings-agent.tsx` (2026-08-31), on the 2026-08-26
 * move's exact argument and for the same reason: that file was at 496 of the 500
 * cap and the agent-chaining switch (Samuel's ruling that day) had to land in it.
 * Not one character of the table or its docblock changed. It belongs here for the
 * reason the row vocabulary does — it is a rendering constant with no reader,
 * writer or decision in it.
 */
export const TOOL_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentToolProfile;
  description: string;
}> = [
  { value: "full", description: "Everything, including connected apps" },
  { value: "dopl_only", description: "Files, web, and Dopl" },
  { value: "read_only", description: "Local files only" },
];

/**
 * The heading over the launch posture. ⚠ IT NAMES THE ACT, NOT A TIME WINDOW.
 * The deleted arm's heading ("For the next request you allow") was doing the whole
 * job of saying "this is single-use" and could not carry it; this pair really is
 * durable, so the honest sentence is the one that says WHICH launches it governs
 * — the ones the operator starts. It must never read "for every session": an
 * inbound request a peer triggered carries no tool posture and starts at manual/ask.
 */
export const LAUNCH_POSTURE_HEADING = "When you launch an agent";

/** The sub-heading that separates each group. ⚠ Every group on this tab is
 *  DURABLE — nothing single-use is left anywhere in the product — so the headings
 *  say what each one GOVERNS rather than how long it lasts. A heading naming a
 *  time window is the regression (`use-channel-launch-posture.ts`). */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </p>
  );
}

/** A setting's NAME — primary ink, because it is the thing being set. */
export function SettingName({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-body font-medium text-text-primary">{children}</p>
  );
}

// ⚠ `Note` STOOD IN `settings-agent.tsx` AND IS DELETED (2026-08-22). It was the
// tab's one secondary-line recipe and its only two callers were trust's SCOPE
// hint and the empty-roster line, both of which went with the "Always allow"
// section. The minimal-copy ruling (INVARIANTS §5) stands: a row on this tab is a
// NAME + a CONTROL, and there is now no recipe here to hang a third sentence off.

/**
 * A named setting with its control on the right. The 380px panel (2026-08-25) is why the
 * control sits beside the name rather than under it: a `SelectMenu` pill is
 * ~120px and the name ~80px, so one line holds both and the column stays
 * scannable.
 */
export function SettingRow({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[32px] items-center gap-2">
      <span className="shrink-0 text-body font-medium text-text-primary">
        {name}
      </span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </div>
  );
}
