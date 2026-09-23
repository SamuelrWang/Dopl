"use client";

/**
 * Direct 1:1 composer to one agent instance, shared by the agent window and the slide-out panel.
 * Out-of-band: neither the text nor the reply is posted to the thread. Rendered only when it can send;
 * idle/waiting agents take a message (it wakes them); an ended one gets no input, only a pending verdict.
 */

import { useEffect, useRef, useState } from "react";
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { useAutoGrow } from "./use-auto-grow";
import { cn } from "@/shared/lib/utils";
import { TAB_ACTION } from "./bits";
import { canMessageAgent, messageAgent } from "./agents-controls";
import { canSignInToClaude, signInToClaude } from "./claude-signin";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import { agentAuthHeldCopy, canSignIn as runtimeCanSignIn, signInAction } from "../lib/runtime-copy";

/** What a refused 1:1 message says. */
export const MESSAGE_REFUSED =
  "That didn't reach your agent. It may have just ended.";
/** The auth-held line with no descriptor (plain browser, pre-runtime desktop); the live line is
 *  `agentAuthHeldCopy(runtime)`. */
export const MESSAGE_AUTH_HELD = agentAuthHeldCopy(null);

/** Detects the bridge op (never the always-defined wrapper), read once after mount via lazy state
 *  so server and first client render agree. */
export function useCanMessageAgent(): boolean {
  const [can] = useState(() => canMessageAgent());
  return can;
}

/** `claude.signIn` — a separate capability from {@link useCanMessageAgent} (a strictly smaller set
 *  of builds); lazy state, like its twin. */
export function useCanSignInToClaude(): boolean {
  const [can] = useState(() => canSignInToClaude());
  return can;
}

export function AgentComposer({
  channelId,
  taskId,
  agentId,
  runtimeId,
  name,
  ended = false,
  className,
}: {
  channelId: string;
  taskId: string;
  /** Which instance; absent on an older main, which then resolves the oldest live agent. */
  agentId?: string;
  /** The runtime this agent was spawned on (`DesktopSessionSummary.runtimeId`) — whose sign-in
   *  and held copy apply, never the channel's current pick. */
  runtimeId?: string;
  /** The addressee's id, for the placeholder and the label. */
  name: string | null;
  /** `state === "ended"` — the state, never a timestamp (older agents carry no `endedAt`). */
  ended?: boolean;
  /** Host padding only; the recipe stays here. */
  className?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const canSend = useCanMessageAgent();
  // Sign-in button: bridge op AND runtime. A null descriptor (plain browser / older desktop) leaves the
  // bridge op to decide alone; a present one with no in-app flow hides the button (INVARIANTS §11).
  const bridgeCanSignIn = useCanSignInToClaude();
  const runtime = useChannelLaunchPosture(channelId).descriptorOf(runtimeId);
  const canSignIn = bridgeCanSignIn && (runtime == null || runtimeCanSignIn(runtime));
  const authHeldNotice = agentAuthHeldCopy(runtime);

  // One instance serves every agent, so its state is keyed by the addressee; an older main (no
  // `agentId`) addresses `(channel, thread)`.
  const agentKey = agentId ?? `${channelId} ${taskId}`;
  // State, not refs: a ref must not be read or written during render.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  const [shownFor, setShownFor] = useState(agentKey);
  // Mirror for async callbacks only: written in an effect, never read during render.
  const shownForLatest = useRef(agentKey);
  useEffect(() => {
    shownForLatest.current = shownFor;
  }, [shownFor]);

  // Keyed swap during render (adjust-state-on-prop-change): a remount would drop an in-flight
  // verdict; an effect would paint the wrong draft for a frame.
  if (shownFor !== agentKey) {
    setDrafts((prev) => new Map(prev).set(shownFor, text));
    setShownFor(agentKey);
    setText(drafts.get(agentKey) ?? "");
    setNotice(null);
    setBusy(false);
  }

  // An ended agent's draft goes, both the stash and the live text.
  if (ended) {
    // Guarded on presence: an unconditional render-phase update would loop.
    if (drafts.has(agentKey)) {
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(agentKey);
        return next;
      });
    }
    if (text !== "") setText("");
  }

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(inputRef, text);

  if (!canSend) return null;

  // Ended: no input; only the verdict of a send already in flight.
  if (ended) {
    return notice ? (
      <div className={cn("shrink-0 py-3", className)}>
        <p role="alert" className="text-caption text-danger">
          {notice}
        </p>
      </div>
    ) : null;
  }

  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNotice(null);
    // The verdict belongs to the agent it was sent to: dropped if the operator switched meanwhile.
    const sentTo = agentKey;
    void messageAgent({ channelId, taskId, agentId, text: body })
      .then((res) => {
        if (shownForLatest.current !== sentTo) return;
        if (res.ok) {
          setText("");
          return;
        }
        setNotice(res.reason === "auth-hold" ? authHeldNotice : MESSAGE_REFUSED);
      })
      // Same fence: a late `finally` must not unlock another agent's box.
      .finally(() => {
        if (shownForLatest.current === sentTo) setBusy(false);
      });
  };

  // Clears the notice only on `ok`: main resumes held sessions before answering
  // (`session-auth.js › resumeHeldSessions`).
  const signIn = () => {
    if (signingIn) return;
    setSigningIn(true);
    void signInToClaude()
      .then((res) => {
        if (res.ok) setNotice(null);
      })
      .finally(() => setSigningIn(false));
  };

  const label = name ? `Message ${name}` : "Message this agent";

  // `COMPOSER_BOTTOM` aligns this box with the channel composer beside it.
  return (
    <div className={cn("shrink-0 pt-3", COMPOSER_BOTTOM, className)}>
      {/* The shared row (`composer-input.tsx`); do not restyle it from here. */}
      <ComposerInputRow
        // `pill` here; the channel composer mounts `bare` because its card wears the edge.
        face="pill"
        inputRef={inputRef}
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          // IME guard: Enter while composing commits a candidate.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={label}
        ariaLabel={label}
        disabled={busy}
        onSend={send}
        sendDisabled={busy || text.trim() === ""}
        sendTitle={label}
        sendLabel="Send"
      />
      {/* The button is the alert's sibling, never its child: the alert text is the pinned contract. */}
      {notice && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption text-danger">
            {notice}
          </p>
          {notice === authHeldNotice && canSignIn && (
            <button
              type="button"
              onClick={signIn}
              disabled={signingIn}
              className={TAB_ACTION}
            >
              {/* `signInAction` is null exactly where `canSignIn` is false; the fallback guards a
                  partial descriptor. */}
              {signInAction(runtime) ?? "Sign in"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
