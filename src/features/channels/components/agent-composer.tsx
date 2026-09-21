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

import { useEffect, useRef, useState } from "react";
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { useAutoGrow } from "./use-auto-grow";
import { cn } from "@/shared/lib/utils";
import { TAB_ACTION } from "./bits";
import { canMessageAgent, messageAgent } from "./agents-controls";
import { canSignInToClaude, signInToClaude } from "./claude-signin";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import { agentAuthHeldCopy, canSignIn as runtimeCanSignIn, signInAction } from "../lib/runtime-copy";

/** What a refused 1:1 message says. ⚠ Exported for the tests — a swallowed
 *  refusal and a sent message are indistinguishable on screen, which is the
 *  failure this whole surface was built to stop repeating. */
export const MESSAGE_REFUSED =
  "That didn't reach your agent. It may have just ended.";
/**
 * ⚠ THE AUTH-HELD LINE IS THE RUNTIME'S OWN SINCE 2026-09-21 (U10), where it was a frozen
 * `"…sign in to Claude Code."` on a path every runtime reaches — the agent held here may be a
 * Codex or a Cursor one, and naming Claude at it points the operator at a credential the session
 * does not use. {@link agentAuthHeldCopy} builds it from the channel's own descriptor.
 *
 * ⚠ THE EXPORT SURVIVES AS THE **DEFAULT-RUNTIME** SPELLING, and it is still the honest fallback:
 * a plain browser and a desktop older than the runtime port send no descriptor at all, and
 * `runtimeLabel` then names no vendor. It is no longer an equality key — the suites compare
 * against `agentAuthHeldCopy(descriptor)` for the runtime under test.
 */
export const MESSAGE_AUTH_HELD = agentAuthHeldCopy(null);

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
  // ⚠ TWO GATES, AND BOTH HAVE TO HOLD (2026-09-21, U10). The BRIDGE gate is unchanged and is
  // this file's oldest rule: only a build carrying `claude.signIn` can do anything here, so an
  // older main paints no button. The RUNTIME gate is new: `credential.interactiveSignIn` is
  // `null` on Codex and Cursor (their sign-in is a browser/device-code hop Dopl cannot complete
  // in its own window), and the op behind this button drives the DEFAULT runtime's flow — so
  // showing it on a Codex channel would open the wrong sign-in, which is worse than opening none.
  // ⚠ HIDE, NEVER GRAY, AND THE SENTENCE IS NOT HIDDEN WITH IT: the banner still says the agent
  // is waiting on a sign-in; what goes away is a remedy that would not work.
  const bridgeCanSignIn = useCanSignInToClaude();
  const { descriptor: runtime } = useChannelLaunchPosture(channelId);
  // ⚠ UNKNOWN IS NOT EMPTY (INVARIANTS §11), AND THAT IS WHY THIS IS A THREE-WAY TEST. `runtime`
  // is `null` on a plain browser and on every desktop older than the runtime port — reading that
  // absence as "this runtime has no sign-in" would DELETE the button on exactly the builds where
  // it is the only remedy that exists. A descriptor that is PRESENT and declares no in-app flow
  // hides it; one that was never sent decides nothing and the bridge op is the whole gate, which
  // is byte-identical to what those builds did before U10.
  const canSignIn = bridgeCanSignIn && (runtime == null || runtimeCanSignIn(runtime));
  const authHeldNotice = agentAuthHeldCopy(runtime);

  // ⚠ ONE COMPONENT INSTANCE SERVES EVERY AGENT, so its state has to be told
  // WHICH agent it is holding (Samuel, 2026-09-05: typing to A, switching to B
  // and finding A's words in B's box). React keeps the state of a component that
  // stays mounted, which is correct behaviour and the wrong default here.
  // ⚠ THE ADDRESSEE, NOT THE SURFACE: `agentId` is the instance coordinate every
  // session op takes. An older main sends no `agentId` and resolves
  // `(channel, thread)` to the oldest live agent on the thread — so that pair IS
  // the addressee there, and is the honest key for that build.
  const agentKey = agentId ?? `${channelId} ${taskId}`;
  // ⚠ STATE, NOT REFS (2026-09-05, first lint run). The swap below is React's documented
  // adjust-state-during-render pattern, but it was written against REFS — and reading or
  // writing a ref during render is the one part of that pattern React does not sanction: it
  // is invisible to the renderer, so a double-invoked or interrupted render sees a mutation
  // that never happened for it. The behaviour here is unchanged (no remount, no effect, no
  // wrong frame); only the storage moved to the place a render is allowed to touch.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  const [shownFor, setShownFor] = useState(agentKey);
  // ⚠ AND A MIRROR FOR THE ASYNC READERS ONLY. The send callbacks below resolve long after
  // their render and must compare against WHO IS ON SCREEN NOW, not who was when they were
  // created — the captured-key check that keeps a late verdict off the next agent's box. This
  // ref is written in an effect and read only from callbacks; never during render.
  const shownForLatest = useRef(agentKey);
  useEffect(() => {
    shownForLatest.current = shownFor;
  }, [shownFor]);

  // ⚠ **A KEYED SWAP DURING RENDER, NOT A REMOUNT AND NOT AN EFFECT.** A
  // remount (`key={agentId}`) would fix the draft and lose everything else the
  // box is holding — an in-flight send's verdict most of all, which is the one
  // thing this surface promises to deliver (see the header). An effect would
  // paint the wrong agent's draft for one frame first. This is React's own
  // adjust-state-on-prop-change pattern: it re-renders before committing, so
  // nothing wrong is ever shown.
  if (shownFor !== agentKey) {
    setDrafts((prev) => new Map(prev).set(shownFor, text));
    setShownFor(agentKey);
    setText(drafts.get(agentKey) ?? "");
    // ⚠ THE NOTICE AND THE BUSY FLAG SWAP TOO, and leaving them would have been
    // the same bug in the two fields nobody mentioned: a refusal reading
    // "that didn't reach your agent" under the box of an agent it was never
    // about, and a send button disabled by somebody else's in-flight request.
    setNotice(null);
    setBusy(false);
  }

  // ⚠ DEAD IS DEAD, AND A DRAFT TO A DEAD AGENT GOES WITH IT. Nothing revives an
  // ended session, so a saved draft addressed to one is a trap rather than a
  // convenience: it can only ever be re-read and re-typed somewhere else.
  // ⚠ BOTH COPIES, and the live one is the one that would have been missed: the
  // stash only holds agents that are NOT on screen, so an agent that ends while
  // you are looking at it still has its words in `text`. Guarded on non-empty so
  // the render-phase update runs once instead of looping.
  if (ended) {
    // ⚠ GUARDED ON PRESENCE, because the store is state now: an unconditional delete would
    // queue an update on every render and spin. The old ref-mutation could not loop, which is
    // exactly the kind of difference this move has to state out loud.
    if (drafts.has(agentKey)) {
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(agentKey);
        return next;
      });
    }
    if (text !== "") setText("");
  }

  // ⚠ MUST SIT WITH THE OTHER HOOKS, ABOVE EVERY EARLY RETURN. The channel
  // composer has had auto-grow since 2026-08-20 and this box was still pinned at
  // one line, clipping the second invisibly — the same defect that extracted the
  // hook, in the surface that did not get it. Same ceiling (3 lines), same hook,
  // deliberately not a second copy.
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(inputRef, text);

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
    // ⚠ THE VERDICT BELONGS TO THE AGENT IT WAS SENT TO. Captured at send time
    // and checked on the way back, because the operator can switch agents while
    // main is deciding — and without this the answer to A's send would clear B's
    // draft or raise A's refusal under B's box. Dropping it is correct rather
    // than lossy: the surface for that send is no longer on screen, and the send
    // itself either happened or did not regardless of what is being looked at.
    const sentTo = agentKey;
    void messageAgent({ channelId, taskId, agentId, text: body })
      .then((res) => {
        if (shownForLatest.current !== sentTo) return;
        if (res.ok) {
          // Cleared only on a real send. A refused message stays in the box,
          // because retyping something main never took is the worst way to learn
          // it was refused.
          setText("");
          return;
        }
        setNotice(res.reason === "auth-hold" ? authHeldNotice : MESSAGE_REFUSED);
      })
      // ⚠ SAME FENCE: a late `finally` from A's send must not unlock a box that
      // is now B's and may have a request of its own in flight.
      .finally(() => {
        if (shownForLatest.current === sentTo) setBusy(false);
      });
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
        inputRef={inputRef}
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
          {notice === authHeldNotice && canSignIn && (
            <button
              type="button"
              onClick={signIn}
              disabled={signingIn}
              className={TAB_ACTION}
            >
              {/* ⚠ THE RUNTIME'S OWN WORDS (2026-09-21, U10), never a literal. `signInAction`
                  answers `null` exactly where `canSignIn` above is false, so the `??` arm is
                  unreachable in practice and is there so a partial descriptor cannot render an
                  empty button. */}
              {signInAction(runtime) ?? "Sign in"}
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
