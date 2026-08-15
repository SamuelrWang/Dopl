"use client";

import { useEffect, useRef, useState } from "react";
import { setSoundOn } from "../sound-preference";
import { SpeakerIcon, SpeakerMutedIcon } from "./icons";

/**
 * Looping ambient bed for the landing page, plus the small speaker toggle that
 * sits in the bottom-left corner. Rendered once, at the page level
 * (`src/app/page.tsx`) — the home page only. `/pricing` and `/get-started`
 * import the same stylesheet but not this component, and they should not: the
 * bed belongs to the landing scene, not to every `.lp` surface.
 *
 * ── Intent is ON, but the BUTTON never lies ────────────────────────────────
 * Unmuted autoplay is blocked by default in every current browser, so the
 * mount-time `play()` usually rejects. When it does, we arm one-shot
 * `pointerdown`/`keydown` listeners on the document and start on the visitor's
 * first interaction — the standard "first gesture unlocks audio" path.
 *
 * The rendered state is NOT that intent: `playing` is driven only by the
 * element's own `play`/`pause` events, so between mount and the first gesture
 * the button honestly reads "off" (SSR renders it that way too, and the flip is
 * the moment sound actually starts). `stoppedByUser` is the one piece of intent
 * we keep, and it exists solely to disarm the pending gesture listener: someone
 * who hits the toggle before the bed ever started must not get a surprise when
 * they later click somewhere else on the page.
 *
 * ── The loop is a fade, not the `loop` attribute ──────────────────────────
 * `loop` splices the tail of the file onto its head with no ramp. The effect
 * below watches `timeupdate` instead and, one fade-length from the end, runs the
 * same ramp the toggle runs: down to silence, seek to 0, back up. `ended` is
 * kept as the backstop for the cases `timeupdate` cannot land on (throttling in
 * a hidden tab, a toggle that cancelled the seam ramp).
 *
 * The gesture listener ignores events inside the toggle itself. Without that,
 * the click that turns the bed ON would first be caught by the listener (which
 * starts playback synchronously — `play()` clears `paused` before its promise
 * settles), and the button handler would then read "already playing" and pause
 * it — the toggle would appear inverted on exactly one click.
 */

const AUDIO_SRC = "/audio/landing-ambient.mp3";

/** A bed, not a soundtrack — present in the room, still quiet enough to talk over. */
const VOLUME = 0.75;

/** Every start/stop — and every loop boundary — rides a volume ramp this long, so
 *  the bed never cuts in or out abruptly. Pausing happens only after the ramp
 *  reaches silence. */
const FADE_MS = 700;

/** How far from the end of the file the loop ramp starts, in seconds. The ramp
 *  down and the ramp up on the far side of the seam are the same ramp a manual
 *  toggle gets, so a lap boundary should read as nothing at all. */
const LOOP_FADE_S = FADE_MS / 1000;

/** In-flight ramp bookkeeping: the rAF id, plus the timer that force-lands the
 *  ramp when rAF never delivers a final frame. */
type Fade = { id: number | null; timer: number | null };

function cancelFade(holder: Fade) {
  if (holder.id !== null) cancelAnimationFrame(holder.id);
  if (holder.timer !== null) clearTimeout(holder.timer);
  holder.id = null;
  holder.timer = null;
}

/** Ramp `el.volume` toward `target`. `holder` carries the in-flight ramp so a new
 *  ramp always cancels the previous one (rapid toggling must not stack).
 *
 *  rAF is the smooth path but it stops entirely in a backgrounded tab, and the
 *  loop seam runs unattended — a stalled ramp there would strand the bed at
 *  whatever volume the last visible frame left, and never fire `onDone`. The
 *  timer is the floor: throttled to ~1s in the background, but it fires, so the
 *  ramp always lands and the seam always completes. */
function fadeTo(el: HTMLAudioElement, holder: Fade, target: number, onDone?: () => void) {
  cancelFade(holder);
  const from = el.volume;
  const start = performance.now();
  const land = () => {
    cancelFade(holder);
    el.volume = target;
    onDone?.();
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / FADE_MS);
    if (t < 1) {
      el.volume = from + (target - from) * t;
      holder.id = requestAnimationFrame(step);
    } else {
      land();
    }
  };
  holder.id = requestAnimationFrame(step);
  holder.timer = window.setTimeout(land, FADE_MS + 100);
}

export function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const stoppedByUser = useRef(false);
  const restarting = useRef(false);
  const fade = useRef<Fade>({ id: null, timer: null });
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    // `stoppedByUser` is a ref and starts false on every mount, but the shared
    // flag it mirrors is module state that outlives one. A visitor who muted,
    // client-navigated to `/pricing` and came back would otherwise land with a
    // bed that restarts audibly and clicks that stay silent. Re-sync rather than
    // assume: this effect and the ref are created together.
    setSoundOn(!stoppedByUser.current);

    // Start silent; the `play` listener below fades up to VOLUME, so the very
    // first note (autoplay or gesture-unlocked) arrives on the same ramp as a
    // manual toggle.
    el.volume = 0;
    const holder = fade.current;
    const onPlay = () => {
      setPlaying(true);
      fadeTo(el, holder, VOLUME);
    };
    const onPause = () => {
      // A finished lap pauses the element for an instant before `onEnded` starts
      // the next one. The button must not blink "off" for a lap seam it was
      // never off for — only a real stop reaches this.
      if (!el.ended) setPlaying(false);
    };

    // The bed loops on a fade, not on the `loop` attribute — that attribute
    // splices the tail straight onto the head, and this track does not meet
    // itself cleanly there. Approaching the end we ramp to silence, seek back to
    // 0, and ramp up again, reusing the toggle's ramp so the seam sounds like
    // the rest of the bed.
    const onTimeUpdate = () => {
      if (restarting.current || stoppedByUser.current) return;
      const { duration, currentTime } = el;
      // Metadata not in yet, or a file too short to hold a full out-and-in ramp
      // — one that spent its whole length fading would be a tremolo, not a bed.
      // `onEnded` restarts those instead.
      if (!Number.isFinite(duration) || duration < LOOP_FADE_S * 2) return;
      if (duration - currentTime > LOOP_FADE_S) return;
      restarting.current = true;
      fadeTo(el, holder, 0, () => {
        el.currentTime = 0;
        restarting.current = false;
        // Muted mid-seam: the toggle owns the volume now and its own ramp will
        // pause us, so start the next lap silent rather than talking over it.
        if (!stoppedByUser.current) fadeTo(el, holder, VOLUME);
      });
    };

    // Safety net for every path `timeupdate` cannot land: a file shorter than the
    // ramp, a backgrounded tab that throttled `timeupdate` past the seam, or a
    // toggle that cancelled the seam ramp mid-flight. Restart from silence and
    // let `onPlay` ramp it back up — the same ramp, one lap late.
    const onEnded = () => {
      el.currentTime = 0;
      restarting.current = false;
      if (stoppedByUser.current) {
        setPlaying(false);
        return;
      }
      el.volume = 0;
      void el.play().catch(() => {});
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ended", onEnded);

    let disarm = () => {};
    const onGesture = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && buttonRef.current?.contains(target)) return;
      disarm();
      if (stoppedByUser.current) return;
      void el.play().catch(() => {});
    };
    const arm = () => {
      document.addEventListener("pointerdown", onGesture);
      document.addEventListener("keydown", onGesture);
      disarm = () => {
        document.removeEventListener("pointerdown", onGesture);
        document.removeEventListener("keydown", onGesture);
      };
    };

    void el.play().catch(() => {
      if (!stoppedByUser.current) arm();
    });

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ended", onEnded);
      cancelFade(holder);
      disarm();
    };
  }, []);

  /** The only writer of `stoppedByUser`. This toggle is the landing page's one
   *  sound control and the bed is no longer its only listener — the button
   *  clicks in `click-sound.tsx` read the same intent — so the two must move
   *  together or muting the page would silence the bed and leave the clicks
   *  firing. Mirrored through here rather than set at each site so they cannot
   *  drift apart. */
  const setStopped = (next: boolean) => {
    stoppedByUser.current = next;
    setSoundOn(!next);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    // `stoppedByUser` is the tiebreak for a toggle raced against a fade-out:
    // turning back on mid-fade cancels the pending pause (the onDone below
    // checks it) and ramps straight back up from wherever the volume is.
    if (el.paused || stoppedByUser.current) {
      setStopped(false);
      if (el.paused) {
        void el.play().catch(() => {});
      } else {
        fadeTo(el, fade.current, VOLUME);
      }
    } else {
      setStopped(true);
      fadeTo(el, fade.current, 0, () => {
        if (stoppedByUser.current) el.pause();
      });
    }
  };

  return (
    <>
      {/* Instrumental ambience, no speech — nothing to caption. */}
      {/* No `loop`: the effect above loops it on a fade instead. */}
      <audio ref={audioRef} src={AUDIO_SRC} preload="auto" />
      <button
        ref={buttonRef}
        type="button"
        className="lp-icon-btn lp-audio-toggle"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? "Turn off background audio" : "Turn on background audio"}
      >
        {playing ? <SpeakerIcon size={15} /> : <SpeakerMutedIcon size={15} />}
      </button>
    </>
  );
}
