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
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { cn } from "@/shared/lib/utils";
import { TAB_ACTION } from "./bits";
import { canMessageAgent, messageAgent } from "./agents-controls";
import { canSignInToClaude, signInToClaude } from "./claude-signin";

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

/**
 * CAN THIS BUILD ANSWER THE WAITING BANNER — the same read, one op along.
 *
 * ⚠ IT IS A SEPARATE CAPABILITY FROM {@link useCanMessageAgent} and must stay
 * one. Every desktop with the 1:1 composer has `sessions.message`; only a build
 * carrying `claude.signIn` can DO anything about an auth hold, and that set is
 * strictly smaller. Reading one for the other paints a button on exactly the
 * builds where it cannot work — the `canOpenAgentWindow` mistake, in the one
 * place where the surface's whole promise is "this is fixable from here".
 * ⚠ LAZY STATE, like its twin: the bridge is a window global, and a render-time
 * read makes the server render and the first client render disagree.
 */
export function useCanSignInToClaude(): boolean {
  const [can] = useState(() => canSignInToClaude());
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
  const [signingIn, setSigningIn] = useState(false);
  const canSend = useCanMessageAgent();
  const canSignIn = useCanSignInToClaude();
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

  // ⚠ THE ONE ACTION THAT CLEARS ITS OWN NOTICE, because it is the only one that
  // fixes the thing the notice is about. Main resumes every held session before
  // it answers `ok` (`session-auth.js › resumeHeldSessions`), so by the time this
  // lands the agent is live again and the banner is stale — leaving it up would
  // send the operator round the sign-in a second time.
  // ⚠ AND ONLY ON `ok`. A declined dialog or a sign-in that did not finish leaves
  // the banner exactly where it was: the state it describes is still true, and a
  // surface that clears on "I asked" rather than on "it worked" is how a held
  // agent comes to look ready.
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

  // ⚠ THE BOTTOM IS `COMPOSER_BOTTOM`, NOT THIS SURFACE'S OWN NUMBER (Samuel, live review
  // 2026-08-27). This pane is `inset-y-0` against the same bottom edge the message pane ends on,
  // so the channel composer's box and this one are side by side — and a `py-3` here against a
  // `pb-4` there put them on two different lines, 4px apart. The TOP stays `pt-3`: what sits
  // above this is a work stream, not a transcript, and that spacing is not what aligns.
  return (
    <div className={cn("shrink-0 pt-3", COMPOSER_BOTTOM, className)}>
      {/* ⚠ THE SHARED ROW, AND THIS SURFACE IS NOTHING BUT IT (`composer-input.tsx`). The bar's
          whole face — ring, radius, padding, gap, field type, send button — lives there, so the
          channel composer's input row and this one are the same tree rather than two trees given
          the same class strings. That earlier arrangement rendered visibly differently side by
          side, which is what this component replaced. **Do not restyle it from here.** */}
      <ComposerInputRow
        // ⚠ PILL: on THIS surface the row is the only object there is, so it wears the face. The
        // channel composer mounts the same row `face="bare"` because its CARD wears that same
        // edge instead — one box per surface, either way.
        face="pill"
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          // ⚠ IME GUARD, the same one the channel composer keeps: `isComposing` means the Enter
          // is committing a candidate, not submitting.
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
      {/* ⚠ `role="alert"`, not `status`: it appears only AFTER the operator
          pressed Send, and it is the one thing on this surface that says the
          message did not land. Same role the launch refusals wear.
          ⚠ THE BUTTON IS THE ALERT'S SIBLING, NEVER ITS CHILD. The alert's TEXT
          is the pinned contract (`MESSAGE_AUTH_HELD` / `MESSAGE_REFUSED`, read
          verbatim by this composer's suites), and a control nested inside it
          would silently rewrite `textContent` for every reader — screen readers
          included, which would announce the label as part of the sentence. */}
      {notice && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption text-danger">
            {notice}
          </p>
          {/* ⚠ THE ONE REFUSAL WITH A REMEDY, so it is the only one that grows a
              button. `MESSAGE_REFUSED` means the agent is gone and nothing here
              brings it back; `MESSAGE_AUTH_HELD` means this MAC is signed out,
              which is a thing the operator can fix without leaving the surface.
              ⚠ RENDERED ONLY WHEN THE BRIDGE OP EXISTS ({@link
              useCanSignInToClaude} detects `claude.signIn` itself, never the
              wrapper) — on an older main and in a plain browser the banner reads
              exactly as it did, with no button that could only refuse. That is
              this file's oldest rule and it earned it once already.
              ⚠ `TAB_ACTION`, THE SHARED DARK PILL, not a local recipe: it is the
              same 36px object as "New thread" and "Launch agent", which is what
              makes it read as the surface's one action rather than as chrome. */}
          {notice === MESSAGE_AUTH_HELD && canSignIn && (
            <button
              type="button"
              onClick={signIn}
              disabled={signingIn}
              className={TAB_ACTION}
            >
              Sign in to Claude
            </button>
          )}
        </div>
      )}
      {/* ⚠ THE "only your agent sees this" LINE MOVED TO THE EMPTY STATE (Samuel, 2026-08-27)
          — `agent-stream.tsx › agentDirectCaption`, centred under "Send a message to wake agent".
          It is the surface's one genuinely surprising property (an input under a transcript
          normally posts to it), and it belongs where the operator is looking BEFORE they type,
          not as a footnote under the bar they have already used. **Do not re-add it here**: two
          statements of one fact is how the two come to word it differently. */}
    </div>
  );
}
