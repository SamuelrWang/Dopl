/**
 * COMPOSER MODES — the two things a keystroke in a channel can be. The composer
 * says which BEFORE Enter:
 *
 * - CHAT (default) — plain channel message. No subject, thread, or addressee.
 *   `intent: "chat"` says so on the wire, so the routing side never has to infer
 *   "probably didn't mean to start anything" from a missing field. Reaches
 *   nobody's machine.
 * - REQUEST — titled thread addressed to one member via the create-thread path:
 *   posts the opening message and starts that member's agent.
 *
 * The line between them is whether anything starts on someone else's machine,
 * and their consent prompt needs the title only request carries. Server draws
 * the same line (a human `to` under chat is a 400).
 *
 * ⚠ `@` in a body is PLAIN TEXT — it no longer resolves to anything.
 *
 * ⚠ Chat's label reads "Message" but the WIRE VALUE stays `chat` — it is
 * `MessageIntent`, the server's own vocabulary; renaming is a protocol change.
 *
 * Everything here is pure so both shapes can be pinned without a DOM.
 */

import type { MessageIntent } from "../types";

/** ⚠ ALIAS of the wire `MessageIntent`, never a parallel union — a second copy
 *  of the two strings is a second thing to drift. */
export type ComposerMode = MessageIntent;

/** Chat is the default: the resting state must be the one that costs nothing.
 *  Starting somebody's agent is opt-in. */
export const DEFAULT_COMPOSER_MODE: ComposerMode = "chat";

/**
 * Pill slots, in order. `hint` states the CONSEQUENCE, not the label, and is
 * deliberately TARGET-FREE — the menu opens before a target is resolved; the
 * help line under the composer is where the addressee gets named.
 */
export const COMPOSER_MODE_OPTIONS: ReadonlyArray<{
  key: ComposerMode;
  label: string;
  hint: string;
}> = [
  { key: "chat", label: "Message", hint: "Goes to the channel. No agent is started." },
  { key: "request", label: "Request", hint: "Opens a thread and starts their agent." },
];

/** The pill's own face: the picked slot's label. */
export function composerModeLabel(mode: ComposerMode): string {
  return COMPOSER_MODE_OPTIONS.find((o) => o.key === mode)?.label ?? mode;
}

/** What else the help line needs to know beyond the mode and the addressee. */
export interface ComposerHelpState {
  /** Why the draft cannot send yet, from {@link buildComposerPayload}. */
  blocked?: ComposerBlockedReason | null;
}

/**
 * The line under the composer. Names the CONSEQUENCE, not the mode — what an
 * operator gets wrong is what Enter will do, never the label. Chat's line is
 * FIXED; it never varies with the body. Without a `targetName`, request mode
 * says what is missing rather than promising an outcome it can't deliver.
 *
 * Three `blocked` states surfaced, and only three:
 *  - ⚠ `stale-roster` checked FIRST — the on-screen roster still belongs to the
 *    channel you switched away from, so every other line would name the wrong
 *    person;
 *  - `missing-recipient` — already covered by a null `targetName`;
 *  - `missing-subject` — says what the subject is FOR, because a person reads it
 *    in a consent prompt.
 * `empty-body` deliberately NOT surfaced: an empty composer explains itself.
 */
export function composerModeHelp(
  mode: ComposerMode,
  targetName: string | null,
  state: ComposerHelpState = {}
): string {
  if (mode === "chat") {
    return "Message the channel. No agent is started.";
  }
  // ⚠ Ahead of the target: while the roster is stale the name we WOULD print is
  // the previous channel's peer. Only blocked reason about the app rather than
  // the draft, and it clears itself.
  if (state.blocked === "stale-roster") {
    return "Loading who's in this channel…";
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
 * ⚠ CARRIES NO ADDRESSEE, and the absence IS the enforcement — do not re-add
 * `toUserId` / `summary` here. They are the two fields that turn a chat post
 * into an addressed one, and a component reaching past the builder to call
 * `onSend` with an addressee is invisible to any test of a pure payload
 * builder. Absent, that is a type error instead.
 *
 * Lives here, not in the component, so builders and component share one shape.
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
  | "missing-subject"
  | "stale-roster";

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
   * True while the on-screen roster is the PREVIOUS channel's
   * (`useChannelMembers`' `isPlaceholderData`). Request mode is the only reader
   * ({@link resolveRequestTarget} turns it into the wire `toUserId`), so a
   * request built from a stale roster addresses a non-member and 400s
   * `ChannelAddresseeNotMemberError` after the optimistic row is on screen.
   * ⚠ Chat sends never read it and are deliberately NOT gated.
   */
  rosterStale?: boolean;
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
 * Turn a draft into the payload it will send, or say what is missing.
 *
 * ⚠ THE INVARIANT THIS FILE EXISTS FOR: chat mode can ONLY produce a
 * {@link ChatPayload}. No branch, no fallback lets a chat draft open a thread.
 * Addressing state is not even read in chat mode and `@mentions` are decorative
 * text.
 *
 * ⚠ Request mode REQUIRES both recipient and subject and refuses rather than
 * inventing either — never derive a missing subject from the body's first line;
 * that title is what the other operator reads in their consent prompt.
 */
export function buildComposerPayload(draft: ComposerDraft): ComposerBuildResult {
  const body = draft.body.trim();
  if (body.length === 0) return { ok: false, reason: "empty-body" };

  if (draft.mode === "chat") {
    return { ok: true, payload: { kind: "chat", body, intent: "chat" } };
  }

  // ⚠ BEFORE the target is resolved — resolving it IS the bug: a DM whose roster
  // is still the previous channel's has a `peerId`, and it is the wrong person.
  if (draft.rosterStale) return { ok: false, reason: "stale-roster" };

  const toUserId = resolveRequestTarget(draft);
  if (!toUserId) return { ok: false, reason: "missing-recipient" };

  const title = draft.subject.trim();
  if (title.length === 0) return { ok: false, reason: "missing-subject" };

  return { ok: true, payload: { kind: "thread", title, body, toUserId } };
}

// ⚠ Do NOT re-add a `canSubmitComposer` boolean wrapper. The composer builds the
// payload once and needs BOTH halves — the boolean for the send button, the
// REASON for the help line. Reading only the boolean is how a request with no
// subject greyed the button out while the line promised to start someone's agent.

/** What a submitted draft DID. */
export type ComposerSubmitResult = "sent" | "opened" | "blocked";

/**
 * Run a submitted draft. Payload decides the path: chat posts with
 * `intent: "chat"` and no addressing; thread goes through create-thread (title =
 * subject, body = message, to = picked member). ⚠ A surface with no
 * create-thread path REFUSES rather than downgrading a request into an
 * unaddressed post.
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
