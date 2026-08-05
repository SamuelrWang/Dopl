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
 * - CHAT (the default) — a plain channel message. No subject, no thread, no
 *   addressee. `intent: "chat"` says so on the wire, so the routing side never
 *   has to infer "they probably didn't mean to start anything" from the absence
 *   of a field. It reaches nobody's machine, full stop.
 * - REQUEST — the old behavior, made explicit and given back its subject line:
 *   a titled thread addressed to one member, opened through the create-thread
 *   path, which posts the opening message and starts that member's agent.
 *
 * THE LINE BETWEEN THEM is whether anything is started on somebody else's
 * machine, and a person's consent prompt needs the title only request carries.
 * The server draws the same line (a human `to` under chat is a 400).
 *
 * CHAT USED TO HAVE A SECOND CONSEQUENCE. An `@handle` in the body resolved
 * against the channel's named agents and travelled as `toAgents`, so a chat
 * message could start agents by name — the primary way work was handed out.
 * Named agents are gone (rollback §1), so chat has exactly one consequence
 * again and `@` in a body is plain text. Phase 4 replaces the mode toggle with
 * a pill in the input; nothing here changes for that.
 *
 * Everything here is pure so both shapes can be pinned without a DOM: which
 * payload a draft becomes, and what the composer refuses to send, are the two
 * facts this feature turns on.
 */

import type { MessageIntent } from "../types";

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

/** What else the help line needs to know beyond the mode and the addressee. */
export interface ComposerHelpState {
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
 * CHAT'S LINE IS FIXED AGAIN. It briefly MOVED with the body: an `@handle` that
 * resolved to a named agent replaced it with "quartz will act on this", because
 * chat had two consequences and which one you got depended on characters in the
 * text rather than on any visible control. With named agents gone (rollback §1)
 * chat has one consequence and the line simply states it.
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
 */
export function composerModeHelp(
  mode: ComposerMode,
  targetName: string | null,
  state: ComposerHelpState = {}
): string {
  if (mode === "chat") {
    return "Message the channel. No agent is started.";
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
 * IT CARRIES NO ADDRESSEE AT ALL, and the absence is the enforcement. `toUserId`
 * and `summary` used to sit here and were plumbed all the way into
 * `postMessage`, long after the last thing that populated them went away: the
 * composer's only `onSend` call is the chat one. They are exactly the two fields
 * that turn a chat post into an addressed one, so a live wire nobody drives is
 * the shape through which the bug this whole change fixes comes back — one
 * component reaching past the builder and calling `onSend` with an addressee,
 * which no test of a PURE payload builder can see. Deleting them makes that a
 * type error instead. `toAgents` sat here for the same span and is gone for the
 * same reason plus one more: nothing it addressed exists (rollback §1).
 *
 * Lives here rather than in the component so the payload builders and the
 * component agree on one shape.
 */
export interface SendOptions {
  intent?: ComposerMode;
}

/** A plain channel message: no addressee, no summary, no thread. */
export interface ChatPayload {
  kind: "chat";
  body: string;
  intent: "chat";
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
 * addressed, so…" that lets a chat draft open a thread. The addressing state (a
 * stale picked addressee, a DM's peer) is not even read in chat mode, and
 * `@mentions` in the body are DECORATIVE TEXT — reaching a person means
 * starting their machine, and that is request mode's job precisely because it
 * is the shape that carries a title for their consent prompt.
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
    return { ok: true, payload: { kind: "chat", body, intent: "chat" } };
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
export type ComposerSubmitResult = "sent" | "opened" | "blocked";

/**
 * Run a submitted draft. The payload decides the path: a chat payload posts a
 * message with `intent: "chat"` and no addressing; a thread payload goes
 * through the create-thread path (title = subject, body = message, to = the
 * picked member). A surface with no create-thread path wired refuses rather
 * than silently downgrading a request into an unaddressed post.
 *
 * A THIRD OUTCOME used to be checked FIRST, ahead of both: `/new-agent`, the
 * one place a keystroke stopped being a message at all. It summoned a named
 * agent, and it is gone with them (rollback §1) — as is the whole slash-command
 * surface, which had exactly that one entry.
 */
export async function submitComposerDraft(
  params: ComposerDraft & {
    onSend: (body: string, opts?: SendOptions) => Promise<void>;
    onCreateThread?: (input: {
      title: string;
      body: string;
      toUserId: string;
    }) => Promise<unknown>;
  }
): Promise<ComposerSubmitResult> {
  const { onSend, onCreateThread } = params;

  const built = buildComposerPayload(params);
  if (!built.ok) return "blocked";

  if (built.payload.kind === "chat") {
    await onSend(built.payload.body, { intent: "chat" });
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
