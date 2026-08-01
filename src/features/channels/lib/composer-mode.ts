/**
 * COMPOSER MODES — the two different things a keystroke in a channel can be.
 *
 * Until now the composer had ONE send, and that send was always a request: an
 * addressed post carrying a `summary`, which is exactly what wakes the other
 * side's machine. There was no way to just talk. Operators noticed, because a
 * channel that poked a teammate's agent every time you said "morning" is not a
 * channel.
 *
 * So a send is now one of two shapes, and the composer says which BEFORE you
 * press Enter:
 *
 * - CHAT (the default) — a plain channel message. No subject, no thread, and no
 *   HUMAN addressee. `intent: "chat"` says so on the wire, so the routing side
 *   never has to infer "they probably didn't mean to start anything" from the
 *   absence of a field. Left alone it reaches nobody's agent. **`@mention` an
 *   agent and that agent ACTS** — that is not an exception to chat, it is the
 *   primary way an agent is given work: a person talking in the room, naming
 *   who should pick it up. The mentions are resolved from the composed BODY at
 *   send time (`lib/mention.ts`) and travel as `toAgents`.
 * - REQUEST — the old behavior, made explicit and given back its subject line:
 *   a titled thread addressed to one member, opened through the create-thread
 *   path, which posts the opening message and starts that member's agent.
 *
 * THE LINE BETWEEN THEM is who you may reach, not whether anything happens:
 * chat may start AGENTS BY NAME, request is how you ask for a PERSON's agent —
 * and a person's consent prompt needs the title only request carries. The
 * server draws the same line (`server/service-writes-agents.ts`: a human `to`
 * under chat is a 400, `toAgents` is not).
 *
 * Everything here is pure so both shapes can be pinned without a DOM: which
 * payload a draft becomes, and what the composer refuses to send, are the two
 * facts this feature turns on.
 */

import type { ChannelAgent, MessageIntent } from "../types";
import { parseSlashCommand, NEW_AGENT_COMMAND } from "./composer-commands";
import { extractMentionedAgentIds } from "./mention";

/**
 * Chat or Request. Deliberately an ALIAS of the wire `MessageIntent` rather
 * than a parallel union: the toggle picks the intent, and a second copy of the
 * two strings is a second thing to drift.
 */
export type ComposerMode = MessageIntent;

/**
 * CHAT IS THE DEFAULT, deliberately: the surface's resting state must be the
 * one that costs nothing. Starting somebody's agent is the action you opt into.
 */
export const DEFAULT_COMPOSER_MODE: ComposerMode = "chat";

/** The toggle's slots, in order. */
export const COMPOSER_MODE_OPTIONS: ReadonlyArray<{
  key: ComposerMode;
  label: string;
}> = [
  { key: "chat", label: "Chat" },
  { key: "request", label: "Request" },
];

/** "quartz" / "quartz and onyx" / "quartz, onyx and vega". */
function joinHandles(handles: readonly string[]): string {
  if (handles.length <= 1) return handles[0] ?? "";
  return `${handles.slice(0, -1).join(", ")} and ${handles[handles.length - 1]}`;
}

/** What else the help line needs to know beyond the mode and the addressee. */
export interface ComposerHelpState {
  /**
   * Handles of the agents the CURRENT body resolves to (chat mode only). See
   * {@link composerModeHelp} for why the resolved ones and not the raw text.
   */
  mentionedHandles?: readonly string[];
  /** Why the draft cannot send yet, from {@link buildComposerPayload}. */
  blocked?: ComposerBlockedReason | null;
}

/**
 * The one line under the composer that makes the consequence legible.
 *
 * It names the CONSEQUENCE, not the mode ("no agent is started" beats "chat
 * mode"), because the thing an operator got wrong was never the label, it was
 * what pressing Enter would do. `targetName` is the resolved addressee; without
 * one, request mode says what is still missing rather than promising an
 * outcome it cannot deliver.
 *
 * `mentionedHandles` is why this line now MOVES in chat mode. Chat used to have
 * exactly one consequence; it has two, and which one you get depends on
 * characters in the body rather than on any visible control. So the line names
 * the agents that will act, from the RESOLVED handles — a typo'd `@quarzt`
 * resolves to nothing and visibly does not appear, which is the only warning an
 * operator gets before pressing Enter.
 *
 * `blocked` closes the other half of the same gap. `buildComposerPayload`
 * already knows WHY a request refuses, and until now only its boolean reached
 * the screen: a request with a recipient and no subject greyed the send button
 * out while this line went on promising "Opens a thread and starts Ada's
 * agent." Two states are surfaced, and only two —
 *  - `missing-recipient` is already covered by a null `targetName` (the same
 *    sentence, arrived at from the other direction);
 *  - `missing-subject` gets its own line, which says what the subject is FOR
 *    rather than just naming the empty field, because the reason it cannot be
 *    guessed from the body is that a person reads it in a consent prompt.
 * `empty-body` is deliberately NOT surfaced: an empty composer explains itself,
 * and a nag on a field the operator has not started filling is noise.
 *
 * REQUEST ignores mentions entirely, and so does its copy: a request's whole
 * shape is a title plus one person, and the create-thread path takes no agent
 * list. Handles typed there stay decorative text.
 */
export function composerModeHelp(
  mode: ComposerMode,
  targetName: string | null,
  state: ComposerHelpState = {}
): string {
  const handles = state.mentionedHandles ?? [];
  if (mode === "chat") {
    return handles.length > 0
      ? `${joinHandles(handles)} will act on this.`
      : "Message the channel. No agent is started.";
  }
  if (!targetName) {
    return "Pick who this is for. Sending opens a thread and starts their agent.";
  }
  if (state.blocked === "missing-subject") {
    return `Add a subject. ${targetName} sees it when they are asked to approve.`;
  }
  return `Opens a thread and starts ${targetName}'s agent.`;
}

/**
 * Options for a plain message post. `intent` rides along so the server can tell
 * a deliberate chat from an unaddressed request.
 *
 * IT CARRIES NO HUMAN ADDRESSEE, and the absence is the enforcement. `toUserId`
 * and `summary` used to sit here and were plumbed all the way into
 * `postMessage`, long after the last thing that populated them went away: the
 * composer's only `onSend` call is the chat one. They are exactly the two fields
 * that turn a chat post into an addressed one, so a live wire nobody drives is
 * the shape through which the bug this whole change fixes comes back — one
 * component reaching past the builder and calling `onSend` with an addressee,
 * which no test of a PURE payload builder can see. Deleting them makes that a
 * type error instead.
 *
 * `toAgents` stays, because agent addressing is what a chat message legitimately
 * carries: those agents act, and nobody's machine is prompted on their behalf.
 *
 * Lives here rather than in the component so the payload builders and the
 * component agree on one shape.
 */
export interface SendOptions {
  intent?: ComposerMode;
  /** Agent ids resolved from the body's `@handle` tokens. */
  toAgents?: string[];
}

/**
 * A plain channel message: no human addressee, no summary, no thread.
 *
 * `toAgents` is present only when the body actually mentions resolvable agents,
 * and it is ABSENT (not `[]`) otherwise — an empty array on the wire would be a
 * second way to say "addressed nobody", and the two would drift.
 */
export interface ChatPayload {
  kind: "chat";
  body: string;
  intent: "chat";
  toAgents?: string[];
}

/** A titled thread addressed to one member (the create-thread path). */
export interface ThreadPayload {
  kind: "thread";
  title: string;
  body: string;
  toUserId: string;
}

export type ComposerPayload = ChatPayload | ThreadPayload;

/** Why a draft cannot be sent yet. Each maps to a disabled send, not an error. */
export type ComposerBlockedReason =
  | "empty-body"
  | "missing-recipient"
  | "missing-subject";

export type ComposerBuildResult =
  | { ok: true; payload: ComposerPayload }
  | { ok: false; reason: ComposerBlockedReason };

export interface ComposerDraft {
  mode: ComposerMode;
  /** The raw textarea value; trimmed here, once. */
  body: string;
  /** The subject field. Ignored entirely in chat mode (it isn't rendered). */
  subject: string;
  /** True in a direct (1:1) channel: the peer is implicit, so no picker shows. */
  isDirect: boolean;
  /** The resolved peer of a direct channel. */
  peerId: string | null;
  /** The picked addressee in a normal channel. */
  toUserId: string | null;
  /**
   * The channel's agent roster, which is what an `@handle` in the body is
   * resolved AGAINST. Optional so a surface with no agents (and every existing
   * caller) keeps building exactly the payload it built before.
   */
  agents?: readonly ChannelAgent[];
}

/**
 * The addressee a REQUEST would reach: the DM's peer, else the picked member.
 * Chat never asks — a chat message is addressed to no one by construction.
 */
export function resolveRequestTarget(draft: {
  isDirect: boolean;
  peerId: string | null;
  toUserId: string | null;
}): string | null {
  return draft.isDirect ? draft.peerId : draft.toUserId;
}

/**
 * Turn a draft into the payload it will actually send, or say what is missing.
 *
 * THE INVARIANT THIS FILE EXISTS FOR: chat mode can only ever produce a
 * {@link ChatPayload}. There is no branch, no fallback, and no "well, it was
 * addressed, so…" that lets a chat draft open a thread. The HUMAN addressing
 * state (a stale picked addressee, a DM's peer) is not even read in chat mode.
 *
 * AGENT addressing is the one thing chat does carry, and it comes from the BODY
 * rather than from any control: `@handle` tokens resolved against the roster
 * become `toAgents`, so the mentioned agents act. Human `@mentions` stay
 * DECORATIVE TEXT on this path and always will — there is no human-notify path
 * in chat mode by design. Reaching a person means starting their machine, and
 * that is request mode's job precisely because it is the shape that carries a
 * title for their consent prompt.
 *
 * Request mode is the mirror image: it REQUIRES both a recipient and a subject
 * and refuses rather than inventing either. The old composer derived a missing
 * subject from the body's first line; that stays gone, because a request's
 * title is the thing the other operator reads in their consent prompt and a
 * guessed one is how "asdf" ends up being someone's approval decision.
 */
export function buildComposerPayload(draft: ComposerDraft): ComposerBuildResult {
  const body = draft.body.trim();
  if (body.length === 0) return { ok: false, reason: "empty-body" };

  if (draft.mode === "chat") {
    const toAgents = extractMentionedAgentIds(body, draft.agents ?? []);
    return {
      ok: true,
      payload:
        toAgents.length > 0
          ? { kind: "chat", body, intent: "chat", toAgents }
          : { kind: "chat", body, intent: "chat" },
    };
  }

  const toUserId = resolveRequestTarget(draft);
  if (!toUserId) return { ok: false, reason: "missing-recipient" };

  const title = draft.subject.trim();
  if (title.length === 0) return { ok: false, reason: "missing-subject" };

  return { ok: true, payload: { kind: "thread", title, body, toUserId } };
}

// `canSubmitComposer(draft) => buildComposerPayload(draft).ok` used to live here
// and is DELETED, not deprecated. The composer now builds the payload once and
// reads both halves of it — the boolean for the send button, the REASON for the
// help line — because reading only the boolean is exactly how a request with no
// subject greyed the button out while the line went on promising to start
// someone's agent. A convenience wrapper that returns only the half that caused
// that is not a convenience.

/** What a submitted draft DID. */
export type ComposerSubmitResult = "created" | "sent" | "opened" | "blocked";

/**
 * Run a submitted draft.
 *
 * `/new-agent` is checked FIRST and in both modes: it is the one place a
 * keystroke stops being a message at all, and it must NEVER also post (a
 * mistyped command leaking into the transcript while also summoning an agent
 * was the original reason this decision is a function).
 *
 * After that the payload decides the path: a chat payload posts a message with
 * `intent: "chat"` and no HUMAN addressing (plus `toAgents` when the body named
 * agents); a thread payload goes through the
 * create-thread path (title = subject, body = message, to = the picked
 * member). A surface with no create-thread path wired refuses rather than
 * silently downgrading a request into an unaddressed post.
 */
export async function submitComposerDraft(
  params: ComposerDraft & {
    onSend: (body: string, opts?: SendOptions) => Promise<void>;
    onCreateThread?: (input: {
      title: string;
      body: string;
      toUserId: string;
    }) => Promise<unknown>;
    onCreateAgent?: (name?: string) => Promise<unknown>;
  }
): Promise<ComposerSubmitResult> {
  const { onSend, onCreateThread, onCreateAgent } = params;
  const command = parseSlashCommand(params.body.trim());
  if (command?.name === NEW_AGENT_COMMAND && onCreateAgent) {
    await onCreateAgent(command.arg ?? undefined);
    return "created";
  }

  const built = buildComposerPayload(params);
  if (!built.ok) return "blocked";

  if (built.payload.kind === "chat") {
    const { body, toAgents } = built.payload;
    // `toAgents` is spread only when the body resolved some, so an ordinary
    // chat send puts exactly the options on the wire it always did.
    await onSend(body, { intent: "chat", ...(toAgents ? { toAgents } : {}) });
    return "sent";
  }

  if (!onCreateThread) return "blocked";
  await onCreateThread({
    title: built.payload.title,
    body: built.payload.body,
    toUserId: built.payload.toUserId,
  });
  return "opened";
}
