"use client";

/**
 * THE DIRECT 1:1 COMPOSER — F-212's third lane, and since 2026-08-22 it is
 * rendered by BOTH agent surfaces.
 *
 * ⚠ EXTRACTED FROM `agent-window.tsx`, NOT COPIED (Samuel, 2026-08-22: "message
 * the agent from the slide-out panel too"). The window had the only composer and
 * the panel's footer note pointed at it — "open the agent to message it
 * directly" — which is a surface telling the operator to go somewhere else to
 * say one sentence. A second copy of this logic would be two send paths, two
 * refusal vocabularies and two feature detections for one op; there is one of
 * each, here.
 *
 * ⚠ WHAT IT IS NOT: a channel post. Nothing typed here is written to the thread,
 * and the agent's answer is not posted either — `session-seed.js ›
 * frameOperatorTurn` tells the agent so in as many words. That is the whole point
 * of an OUT-OF-BAND lane: the operator steering their own agent is not traffic
 * the counterparty should see.
 *
 * ⚠ IT IS RENDERED ONLY WHEN IT CAN SEND. The panel's own rule, and the reason
 * that surface shipped with NO composer rather than an inert one: an input at the
 * foot of a surface looks exactly like every input that does send, and an inert
 * one is a promise the surface cannot keep. Both hosts read the SAME detector
 * ({@link useCanMessageAgent}) — the panel needs the answer too, to word its
 * footer note, and two reads of one capability is how a note comes to describe a
 * composer that is not there.
 *
 * ⚠ IT ADDRESSES ONE AGENT INSTANCE. `agentId` is the third coordinate every
 * session op has taken since multiplayer (`spa-bridge.ts › DesktopSessionSummary
 * › agentId`); without it main resolves `(channel, thread)` to the OLDEST live
 * agent on the thread, which under multiplayer is a different agent than the card
 * the operator clicked. Absent on an older main's summaries, where that
 * degradation is the correct one and the only one available.
 *
 * ⚠ A PARKED OR IDLE AGENT IS A VALID ADDRESSEE. Under the spawn-idle model an
 * agent starts with no turn at all and the FIRST MESSAGE is what wakes it, so a
 * composer gated on `state === "working"` would make every freshly launched agent
 * unreachable by construction. `working` / `idle` / `waiting` all take a message.
 *
 * ⚠ AN ENDED AGENT DOES NOT, AND THE INPUT IS GONE RATHER THAN DISABLED (Samuel,
 * 2026-08-22: **dead is dead**). Every wake path refuses; nothing revives it. A
 * disabled box would read as "not right now" — a state that will pass — which is
 * the opposite of what ended means. The surrounding surface stays READ-ONLY and
 * fully readable: the work stream, the Sent lane and the retained history are all
 * still there, because what the agent did is exactly what the operator came for.
 *
 * ⚠ AN IN-FLIGHT SEND STILL GETS ITS ANSWER. If the agent ends between Send and
 * main's verdict, the input disappears but the REFUSAL LINE stays: the operator
 * pressed a button and is owed the outcome, and "the box vanished" is not an
 * outcome. That is the one thing this component renders for an ended agent.
 */

import { useState } from "react";
import { SendButton } from "@/shared/ui/send-button";
import { cn } from "@/shared/lib/utils";
import { canMessageAgent, messageAgent } from "./agents-controls";

/** What a refused 1:1 message says. ⚠ Exported for the tests — a swallowed
 *  refusal and a sent message are indistinguishable on screen, which is the
 *  failure this whole surface was built to stop repeating. */
export const MESSAGE_REFUSED =
  "That didn't reach your agent. It may have just ended.";
export const MESSAGE_AUTH_HELD =
  "Your agent is waiting for you to sign in to Claude Code.";

/**
 * CAN THIS BUILD REACH AN AGENT AT ALL — one read, both hosts.
 *
 * ⚠ READ ONCE AFTER MOUNT, via lazy state. The bridge is a window global, so a
 * render-time read makes the server render and the first client render disagree.
 * ⚠ IT DETECTS THE BRIDGE OP, never `messageAgent` — that wrapper is an export of
 * this tree and is always a function, so `typeof` it answers true in a plain
 * browser and renders a composer that can only refuse. That shipped once, in this
 * composer's first draft, and its own test caught it.
 */
export function useCanMessageAgent(): boolean {
  const [can] = useState(() => canMessageAgent());
  return can;
}

export function AgentComposer({
  channelId,
  taskId,
  agentId,
  name,
  ended = false,
  className,
}: {
  channelId: string;
  taskId: string;
  /** WHICH instance. Absent on an older main — see the header. */
  agentId?: string;
  /** The addressee's id, for the placeholder and the label. */
  name: string | null;
  /** `state === "ended"`. ⚠ THE STATE DRIVES THIS, never a timestamp: an agent
   *  that ended before `endedAt` shipped carries no stamp and is no less dead. */
  ended?: boolean;
  /** Host padding. The window sits in a 4-unit gutter, the slide-out panel in
   *  3.5 — layout only; the recipe stays here. */
  className?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canSend = useCanMessageAgent();
  if (!canSend) return null;

  // ⚠ DEAD IS DEAD — no input, at all. The one thing still owed is the verdict on
  // a send that was already in flight when the agent went (see the header); it
  // renders alone, with nothing under it that looks like it would take another.
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
    void messageAgent({ channelId, taskId, agentId, text: body })
      .then((res) => {
        if (res.ok) {
          // Cleared only on a real send. A refused message stays in the box,
          // because retyping something main never took is the worst way to learn
          // it was refused.
          setText("");
          return;
        }
        setNotice(res.reason === "auth-hold" ? MESSAGE_AUTH_HELD : MESSAGE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  const label = name ? `Message ${name}` : "Message this agent";

  return (
    <div className={cn("shrink-0 py-3", className)}>
      {/* ⚠ ONE RAISED BAR, NO HAIRLINES (Samuel, 2026-08-22). It was a concave
          `FIELD_WELL` inside a hairline-topped block — an INSET face, which in
          this kit means "a field pressed into a panel" and read as chrome the
          operator had to find. The composer is the surface's one action, so it
          takes the channel composer's own raised idiom instead: `.raised-tab`,
          THE app-wide raised face (docs/DESIGN-SYSTEM.md), floating on the panel
          with no rule above it and no border around it.
          ⚠ `.raised-tab` SUPPLIES THE FILL, so no `bg-*` utility may ride along:
          Tailwind's utility layer outranks the kit layer and a stray background
          flattens the gradient to nothing. */}
      <div className="raised-tab flex items-center gap-1.5 rounded-[10px] p-1 pl-2.5">
        <textarea
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ⚠ IME GUARD, the same one the channel composer keeps: `isComposing`
            // means the Enter is committing a candidate, not submitting.
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={label}
          aria-label={label}
          // ⚠ THE BAR RESTS AT THE SEND BUTTON'S OWN HEIGHT (30px) — one object,
          // one line, which is what "a bar" means. `resize-none` + `overflow-auto`
          // keep a pasted paragraph from growing the composer over the stream it
          // sits under; Shift+Enter still breaks the line and the box scrolls.
          className="h-[30px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-[6px] text-caption leading-[18px] text-text-primary outline-none placeholder:text-text-muted"
        />
        {/* ⚠ THE GLOBAL SEND AFFORDANCE (`shared/ui/send-button.tsx`), not a
            local icon button. It is the v1 session window's `.send-btn` face and
            is already what the playground's channels pane and the knowledge hero
            chat send with — a third hand-rolled send glyph in one product is how
            three of them come to disagree. */}
        <SendButton onClick={send} disabled={busy || text.trim() === ""} />
      </div>
      {/* ⚠ `role="alert"`, not `status`: it appears only AFTER the operator
          pressed Send, and it is the one thing on this surface that says the
          message did not land. Same role the launch refusals wear. */}
      {notice && (
        <p role="alert" className="mt-1.5 text-caption text-danger">
          {notice}
        </p>
      )}
      {/* ⚠ SAYS WHAT THIS LANE IS, once, because it is the surface's one
          genuinely surprising property: an input under a transcript normally
          posts to it. */}
      <p className="mt-1.5 text-micro text-text-muted">
        Only your agent sees this. It is not posted to the thread.
      </p>
    </div>
  );
}
