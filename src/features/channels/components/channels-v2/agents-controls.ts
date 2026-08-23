"use client";

/**
 * WHAT AN OPERATOR CAN DO TO THEIR OWN AGENT — the imperative half, split out of
 * `agents-model.ts` on 2026-08-20 when the live permission controls landed.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the line count that forced the
 * question. `agents-model.ts` is a PROJECTION: the desktop's session feed and the pure
 * slicing every surface takes from it, which move when the wire shape moves. This is a set
 * of COMMANDS, which move when the bridge grows an op — and it has grown four in three days
 * (pause/end, launch, message, setMode). Two rates of change in one file is how a projection
 * ends up re-reviewed every time a button is added.
 *
 * ⚠ EVERY OP IS FEATURE-DETECTED AT ITS CALL SITE, on the BRIDGE member it is about to use —
 * never on a wrapper exported from this file, and never on `window.dopl` being truthy. The
 * wrapper is always a function, so `typeof someWrapper === "function"` answers true in a
 * plain browser and renders a control that can only refuse (that shipped once, in the agent
 * window's composer, and its own test caught it — hence `canMessageAgent`).
 *
 * ⚠ EVERY OP RETURNS MAIN'S VERDICT AND NO CALLER MAY SWALLOW IT. A control that visibly
 * does nothing and says nothing is the failure this whole family has been bitten by twice
 * (`AGENT_CONTROL_REFUSED`, and the reopen that reported success having opened nothing).
 *
 * ⚠ OWN AGENTS ONLY, STRUCTURALLY RATHER THAN BY A CHECK. Main resolves every one of these
 * against ITS OWN session registry, which holds nothing but this operator's sessions on this
 * machine. There is no cross-machine control op here and this is not the seam to add one.
 *
 * ⚠ EVERY OP TAKES `agentId` AS ITS THIRD COORDINATE (2026-08-22 — F-239's SPA half; the
 * bridge grew the parameter the day before). **THE RULE, STATED ONCE HERE so no signature
 * has to re-argue it:** `(channelId, taskId)` stopped identifying a session on 2026-08-21,
 * because one operator may run SEVERAL agents on one thread. Main resolves the pair to a
 * GROUP and — with no id — picks the OLDEST live member of it. Every op below is invoked
 * from a surface looking at ONE agent's card, so "the oldest one" is not merely imprecise:
 * it is a DIFFERENT agent than the one on screen. Pause stops a stranger, the 1:1 message
 * reaches a stranger, and nothing anywhere reports the substitution.
 *
 * ⚠ IT IS OPTIONAL, AND ITS ABSENCE IS THE CORRECT DEGRADATION rather than a refusal. An
 * older main omits `agentId` from its summaries and cannot accept one — but on such a build
 * there is at most one agent per thread anyway, so oldest-live IS the agent on screen.
 * Passing `undefined` reaches exactly the behaviour that build already had.
 *
 * ⚠ EVERY CALLER ALREADY HOLDS THE SESSION IT CLICKED, so the id is read off that object and
 * never re-derived from a key or a route.
 */

import { useCallback } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";

/** Whether the pause / end controls can be offered at all. Feature-detected like
 *  every other bridge capability: an older main has the feed and not the
 *  controls, and must show no buttons rather than buttons that do nothing.
 *
 *  ⚠ THIS GATES THE STOP VERBS AND NOTHING ELSE. It used to gate the whole
 *  control strip, which hid "Open window" on every main that had `reopen` and
 *  not `pause`/`end` — a real build shape, since `reopen` is the OLD op shared
 *  by both preloads and the other two arrived with the SPA. Three independent
 *  capabilities, three detections; see {@link canOpenAgentWindow}. */
export function canControlAgents(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.pause === "function" && typeof sessions?.end === "function"
  );
}

/**
 * Whether this agent's own window can be revealed — a SEPARATE question from
 * {@link canControlAgents}, and the older capability of the two.
 *
 * ⚠ EITHER OP COUNTS (2026-08-20). `openAgentWindow` is the one that answers the
 * click properly; `reopen` is the OLDER op, which now hands a live windowless
 * session to the very same window in main. A build with only `reopen` still
 * opens the agent view, so gating the button on the new op alone would hide a
 * working affordance — the exact mistake this function's docblock already
 * records having made once with `pause`/`end`.
 *
 * ⚠ Both are detected at the CALL SITE rather than trusted from the type: a main
 * predating either ships a `sessions` object without it, and the type cannot
 * know (INVARIANTS §11).
 */
export function canOpenAgentWindow(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.openAgentWindow === "function" ||
    typeof sessions?.reopen === "function"
  );
}

/**
 * Whether this build can reach an agent directly at all.
 *
 * ⚠ IT DETECTS THE BRIDGE OP, NOT {@link messageAgent}. The wrapper is always a
 * function — it is an export of this module — so `typeof messageAgent` answers
 * `true` in a plain browser and renders a composer that can only ever refuse.
 * That is the exact failure the panel's no-inert-input rule exists to prevent,
 * and it shipped in the first draft of the agent window before its own test
 * caught it. Detect the capability you are about to USE (INVARIANTS §11).
 */
export function canMessageAgent(): boolean {
  return typeof getSpaBridge()?.sessions?.message === "function";
}

/** Whether this build can move a LIVE session's permission posture. Detects the
 *  BRIDGE OP, never the wrapper below — see {@link canMessageAgent} for the bug
 *  that rule was earned by. */
export function canSetAgentMode(): boolean {
  return typeof getSpaBridge()?.sessions?.setMode === "function";
}

/**
 * MOVE A LIVE SESSION'S PERMISSION POSTURE, one axis at a time.
 *
 * ⚠ IT APPLIES FROM THE VERY NEXT GATE DECISION, not the next launch:
 * `main/session-io.js › grantArgs` reads both axes off the reducer state at CALL
 * time, so moving that state IS the change.
 *
 * ⚠ IT IS NOT THE CHANNEL'S DURABLE LAUNCH POSTURE
 * (`hooks/use-channel-launch-posture.ts`, the Settings tab). That writes a record
 * governing the NEXT spawn; this moves ONE running session and stores nothing.
 * Wiring either to the other's consumer would make a per-session decision
 * permanent, or a permanent one per-session.
 *
 * ⚠ SUPERVISION, NOT CONTAINMENT. The axes decide whether the OPERATOR IS ASKED;
 * the tool PROFILE decides what is reachable at all, is checked first, and no
 * posture can widen it (main's `SESSION_HARD_DENY` is unconditional, and `bypass`
 * is a positive allow-list — an unclassified tool gates in every mode).
 */
export async function setAgentMode(payload: {
  channelId: string;
  taskId: string;
  /** WHICH instance — see the module header. */
  agentId?: string;
  axis: "tools" | "messages";
  mode: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.setMode !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.setMode(
    payload.channelId,
    payload.taskId,
    payload.axis,
    payload.mode,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}

/**
 * Whether this build can move a LIVE agent's MODEL (2026-08-22).
 *
 * ⚠ IT DETECTS `sessions.setModel`, the op it is about to USE — the strict form
 * of this family's rule ({@link canMessageAgent} carries the bug that earned it).
 * ⚠ DO NOT WIDEN IT TO `sessions.setMode`. That op is present on every build with
 * the live posture strip, so detecting it would render a model selector on
 * desktops that predate the model op and refuse on all of them.
 */
export function canSetAgentModel(): boolean {
  return typeof getSpaBridge()?.sessions?.setModel === "function";
}

/**
 * MOVE A LIVE AGENT'S MODEL.
 *
 * ⚠ IT PROMISES NO TIMING, AND MAIN DOES NOT REPORT ONE. The two axes' strip can
 * say "from its next decision" because that is provable from the engine
 * (`main/session-io.js › grantArgs` re-reads them at every gate); a model swap
 * may instead need the SDK query rebuilt. **The confirmation is the FEED**, not a
 * sentence: main stamps `DesktopSessionSummary.model` from `system/init` and from
 * every assistant message, so a successful switch re-renders the control from
 * main's own value with no second wiring — which is the same
 * no-optimistic-stamp rule {@link setAgentMode}'s callers follow.
 *
 * ⚠ `""` IS "BACK TO THE DEFAULT", the same wire value the durable row writes as
 * "no id stored" (`lib/agent-models.ts › AGENT_MODEL_DEFAULT`). One vocabulary,
 * two surfaces.
 *
 * ⚠ `agentId` NAMES THE INSTANCE — the module header's rule. Without it main
 * moves the OLDEST live agent on the thread, which under multiplayer is a
 * different agent than the card these controls belong to.
 *
 * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED. A model the operator believes they
 * switched and the agent never ran on is this lane's worst outcome.
 */
export async function setAgentModel(payload: {
  channelId: string;
  taskId: string;
  agentId?: string;
  /** An SDK model id, or `""` for the SDK default. */
  model: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.setModel !== "function") {
    return { ok: false, reason: "no-bridge" };
  }
  const res = await sessions.setModel(
    payload.channelId,
    payload.taskId,
    payload.model,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}

/**
 * TALK TO MY OWN AGENT, out of band — F-212's direct 1:1 lane.
 *
 * ⚠ THE ONE BRIDGE CALL IN THIS MODULE THAT STARTS A TURN. Everything else here
 * reads, stops, or opens a window. Main owns the whole security shape
 * (`main/session-reopen.js › messageByTask` states it in full): the session is
 * resolved by (channel, thread) against main's OWN registry, so this is
 * own-agents-only structurally; the text is delimited with that session's nonce
 * and carries operator authority rather than being fenced as counterparty data;
 * and it dispatches the SAME `steer` the session window's composer always did.
 *
 * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED. A message the operator believes
 * they sent and the agent never received is the worst outcome this lane has.
 */
export async function messageAgent(payload: {
  channelId: string;
  taskId: string;
  /** WHICH instance — see the module header. */
  agentId?: string;
  text: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.message !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.message(
    payload.channelId,
    payload.taskId,
    payload.text,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}

/** Whether this build can LAUNCH an agent onto a thread (2026-08-20). */
export function canLaunchAgents(): boolean {
  return typeof getSpaBridge()?.sessions?.launch === "function";
}

/**
 * START A NEW AGENT ON A THREAD — the Agents tab's "New Agent" button (Samuel,
 * 2026-08-20; re-scoped 2026-08-21). Windowless requester-side session; the click
 * IS the consent (own agent, own thread — no row is raised) and MAIN owns the
 * posture (inbound auto-consumed; out per the channel's auto-send setting).
 *
 * ⚠ EVERY CALL SPAWNS A NEW INSTANCE (2026-08-21, multiplayer agents). It used to
 * resolve to at most one session per `(channel, thread)` and refuse a second with
 * `busy`; main now mints a fresh agent per call and answers with its `agentId`.
 * Nothing here caps that, and nothing may start to — the cap belongs to main
 * (`cap`), which is the only side that knows the machine's budget.
 *
 * ⚠ TWO SUCCESS SHAPES, READ TOLERANTLY, AND THE WIDENING IS THE POINT. The op
 * answered `{ ok, reason }` and now answers `{ agentId }`; main and this tree ship
 * separately, so BOTH shapes are live at once and a reader that knows only one of
 * them turns a real launch into a false refusal (or the reverse). An `agentId`
 * came back ⇒ an agent started, whatever else the object carries. The result is
 * cast rather than typed off the bridge because `spa-bridge.ts` is the DESKTOP's
 * declaration to widen, and this side must survive either version of it.
 *
 * ⚠ `taskId: null` IS A CHANNEL-LEVEL AGENT (2026-08-21, the composer's Bot
 * icon) — an agent on the ROOM, not on one exchange, so it has no thread title
 * and no counterparty. **`null` is not `""`**: the empty string is already a real
 * wire value meaning "a responder session whose thread never became first-class"
 * (`spa-bridge.ts › DesktopSessionSummary`), and collapsing the two would make a
 * deliberate channel agent indistinguishable from a thread that failed to
 * resolve.
 *
 * ⚠ `templateId` IS AN ID, NEVER A SNAPSHOT (2026-08-22, agent templates). The
 * SPA names the identity; **MAIN resolves its content** through
 * `GET /api/agent-templates/{id}/resolve` under the operator's own credential,
 * at spawn. A renderer-supplied `{name, instructions}` would be renderer-authored
 * text landing in a prompt, and main could not tell a real template from a
 * fabricated one — the same class of mistake as F-267, with PROMPT TEXT as the
 * thing that got forged instead of a tool profile. Resolving in main also keeps
 * the knowledge-base viewer filter on the OPERATOR's credential and reads the
 * template fresh, so an edit landed a moment ago is honoured. The picker still
 * renders the name from its own cache — the optimistic render is a LABEL, the
 * authoritative resolve is the PROMPT.
 *
 * ⚠ `overrides` ARE EPHEMERAL AND MAIN RE-VALIDATES THEM
 * (`@/features/agent-templates/lib/launch-overrides.ts`). Nothing here is written
 * back to the template; this side's bounds exist to keep the web from OFFERING a
 * payload main would reject, exactly as `agent-models.ts` does for the roster.
 *
 * ⚠ NO CASTS ANY MORE (2026-08-22, once Phase 1's declaration landed). Both new
 * fields and the widened result are declared on `spa-bridge.ts › launch`, so the
 * payload and the reply are TYPED off the bridge rather than asserted past it.
 * They were cast for exactly as long as the two trees were out of step, which is
 * the same window `taskId: null` spent cast before it.
 *
 * ⚠ THE OPTIONAL CHAINS ON THE REPLY STAY, and they are not redundant with the
 * declaration. `Promise<{ ok: boolean; … }>` is what a CURRENT main answers; the
 * two trees ship separately, so a main predating any given field answers an
 * object without it — and the two-success-shapes rule above means a reply may
 * legitimately carry `agentId` and no `ok` at all. The type describes the
 * contract; the chains survive the build that has not adopted it yet.
 *
 * ⚠ `template-approval` IS NOT A FAILURE, IT IS A QUESTION (2026-08-22). Main
 * refuses the FIRST launch of a foreign template on this machine and hands back
 * the name and instructions it resolved, for the approval modal to show verbatim
 * (`agent-templates/components/template-approval.tsx`). The payload is forwarded
 * here untouched and read tolerantly by the picker; nothing in this module
 * interprets it.
 */
export async function launchAgentOnThread(payload: {
  channelId: string;
  /** The thread, or `null` for a CHANNEL-LEVEL agent. */
  taskId: string | null;
  workspaceId: string;
  channelName: string;
  threadTitle: string | null;
  counterpartyId: string | null;
  direct: boolean;
  /** The identity to wear, or `null`/absent for a BLANK agent. */
  templateId?: string | null;
  /** This run's ephemeral re-points. Absent ⇒ the template's own values. */
  overrides?: TemplateLaunchOverrides;
}): Promise<{
  ok: boolean;
  agentId?: string;
  reason?: string;
  template?: { name?: string | null; instructions?: string | null } | null;
}> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.launch !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.launch(payload);
  const agentId = typeof res?.agentId === "string" && res.agentId ? res.agentId : undefined;
  return {
    ok: res?.ok === true || agentId !== undefined,
    agentId,
    reason: res?.reason,
    template: res?.template ?? null,
  };
}

/**
 * Whether this build can REMEMBER a first-use approval of another member's
 * template (2026-08-22).
 *
 * ⚠ IT DETECTS `sessions.approveTemplate`, the op it is about to USE — the strict
 * form of this family's rule ({@link canMessageAgent} carries the bug that earned
 * it). ⚠ DO NOT WIDEN IT TO `sessions.launch`: every build with the launch op
 * would then claim the approval op, and the modal would spin on a desktop that
 * cannot store the answer.
 *
 * ⚠ THE DECLARATION DOES NOT REPLACE THIS CHECK, and the op being `?`-optional in
 * `spa-bridge.ts` is exactly the point: an older main ships a `sessions` object
 * without the member, and the type cannot know which main is on the other side
 * (INVARIANTS §11). This read no longer needs a local widening — the member is
 * declared — but the `typeof` gate is the real fence and stays.
 */
export function canApproveTemplate(): boolean {
  return typeof getSpaBridge()?.sessions?.approveTemplate === "function";
}

/**
 * STORE THIS OPERATOR'S FIRST-USE APPROVAL of a foreign template, on THIS Mac.
 *
 * ⚠ MACHINE-LOCAL, AND THAT IS THE SECURITY CONTENT rather than a storage
 * detail. Main keeps it in `electron-store` beside `orchestratorLaunchEnabled`,
 * for the reason that toggle's own docblock gives: a spawned session runs with
 * `Bash` and the operator's device token is on disk, so any server-stored version
 * of this flag could be flipped by an agent holding the operator's own credential
 * — pre-approving itself across every machine they own. **There is no route, no
 * MCP op and no settings column for it, deliberately.**
 *
 * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED. An approval the operator believes
 * they gave and main did not store means the next launch asks again, which reads
 * as a broken modal unless this side can say what happened.
 */
export async function approveTemplate(
  templateId: string
): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.approveTemplate !== "function") {
    return { ok: false, reason: "no-bridge" };
  }
  const res = await sessions.approveTemplate(templateId);
  return { ok: res?.ok === true, reason: res?.reason };
}

export type AgentControl = "pause" | "end";

/**
 * PAUSE / END MY OWN AGENT.
 *
 * ⚠ OWN AGENTS ONLY, and there is no other kind reachable from here: the ops
 * resolve `(channelId, taskId)` against MAIN'S OWN session registry, which holds
 * nothing but this operator's sessions on this machine. Nobody pauses another
 * member's agent (Samuel's ruling, INVARIANTS §11) — a peer's paused agent reads as
 * inactive/offline PRESENCE on their side, never as a stalled thread.
 *
 * ⚠ NEITHER OP TOUCHES A THREAD. `end` ends the AGENT; a thread has no finished
 * state on any surface (INVARIANTS §5).
 */
export function useAgentControls() {
  return useCallback(
    async (
      control: AgentControl,
      session: { channelId: string; taskId: string; agentId?: string }
    ): Promise<boolean> => {
      const sessions = getSpaBridge()?.sessions;
      const op = control === "pause" ? sessions?.pause : sessions?.end;
      if (typeof op !== "function") return false;
      const result = await op(session.channelId, session.taskId, session.agentId);
      return result?.ok === true;
    },
    []
  );
}

/**
 * OPEN THE AGENT VIEW — a real window showing what this agent is doing, what it
 * has sent, and a composer that reaches it (`components/channels-v2/agent-window.tsx`).
 *
 * ⚠ IT ALWAYS OPENS SOMETHING NOW (2026-08-20, F-212's closure), and the short
 * history of this function is why that sentence is worth writing down. It began
 * as `reopen`, which revealed the session's own BrowserWindow. The
 * session-window retirement made every responder and every Agents-tab launch
 * WINDOWLESS, so there stopped being a window to reveal — and for a while this
 * returned `{ ok: false, reason: "windowless" }`, which the panel worded as
 * "this agent runs without a window". Samuel called that meaningless, and he was
 * right: **a window is a VIEW, not a runtime property.** Whether main minted a
 * BrowserWindow for a spawn is an implementation detail of the spawn shape, and
 * no answer at all to "show me my agent". So the view exists, and the click
 * opens it.
 *
 * ⚠ TWO OPS, ONE MEANING, NEWEST FIRST. `openAgentWindow` says exactly what the
 * caller wants; `reopen` is the older op and now hands a live windowless session
 * to the SAME window in main, so a build with only `reopen` behaves identically.
 * The fallback is not compatibility theatre — it is the reason the button works
 * on a main that predates the new op.
 *
 * ⚠ `segment` is needed because the window lands on a ROUTER PATH and main holds
 * the workspace UUID, not the slug. Main re-checks it (`isSafeSegment`) and
 * degrades rather than refusing when it is absent.
 */
export async function openAgentWindow(
  session: { channelId: string; taskId: string; agentId?: string },
  segment: string
): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.openAgentWindow === "function") {
    const res = await sessions.openAgentWindow(
      segment,
      session.channelId,
      session.taskId,
      session.agentId
    );
    return { ok: res?.ok === true, reason: res?.reason };
  }
  // ⚠ The optional chain covered `sessions` and not `reopen`, so on a main
  // without either op this threw "reopen is not a function" out of a click
  // handler. Same detection as the gate that hides the button, so the two
  // cannot disagree.
  if (typeof sessions?.reopen !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.reopen(
    session.channelId,
    session.taskId,
    segment,
    session.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}
