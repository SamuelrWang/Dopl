"use client";

import { useEffect, useRef, useState } from "react";
import { audioContext, routeMediaElement } from "../audio-context";
import { setSoundOn } from "../sound-preference";
import { SpeakerIcon, SpeakerMutedIcon } from "./icons";

/**
 * Looping ambient bed + speaker toggle. Rendered once at page level
 * (`src/app/page.tsx`), home page ONLY — `/pricing` and `/get-started` share
 * the stylesheet but must not mount this.
 *
 * ⚠ `playing` is driven only by the element's `play`/`pause` events, never by
 * intent. Unmuted autoplay is blocked, so mount-time `play()` usually rejects
 * and we arm one-shot `pointerdown`/`keydown` gesture listeners. Between mount
 * and first gesture the button must honestly read "off" (SSR renders it that
 * way too). `stoppedByUser` is the only intent kept; its job is disarming the
 * pending gesture listener.
 *
 * ⚠ Gesture listener must ignore events inside the toggle. Otherwise the click
 * that turns the bed ON is caught by the listener first (`play()` clears
 * `paused` before its promise settles), the button handler then reads "already
 * playing" and pauses — toggle appears inverted on exactly one click.
 *
 * ⚠ Loop is a fade, not the `loop` attribute: `loop` splices tail onto head
 * with no ramp and this track doesn't meet itself cleanly. `timeupdate` runs
 * the seam ramp; `ended` is the backstop for what `timeupdate` can't land
 * (hidden-tab throttling, a toggle that cancelled the seam ramp).
 */

const AUDIO_SRC = "/audio/landing-ambient.mp3";

/** A TRIM on the master, not the loudness itself. The asset was re-mastered
 *  +14.5 dB on 2026-08-16 and now peaks at -3.3 dB (re-measure with
 *  `ffmpeg -i public/audio/landing-ambient.mp3 -af volumedetect -f null -`), so
 *  this sits mid-scale deliberately: there is room to go up AND down from here.
 *
 *  ⚠ 1 is a HARD CEILING, not a tuning choice. `HTMLMediaElement.volume` is
 *  spec'd to 0..1 and THROWS `IndexSizeError` above it, which `fadeTo` would hit
 *  the moment a ramp landed. Wanting more than 1 means re-mastering the asset or
 *  adding a Web Audio gain stage — it cannot be done from this constant. */
const VOLUME = 0.6;

/** Every start/stop AND every loop seam rides this ramp. Pause only after the
 *  ramp reaches silence. */
const FADE_MS = 700;

/** Seconds before end-of-file that the loop ramp starts. */
const LOOP_FADE_S = FADE_MS / 1000;

/** rAF id + the timer that force-lands the ramp when rAF drops the last frame. */
type Fade = { id: number | null; timer: number | null };

function cancelFade(holder: Fade) {
  if (holder.id !== null) cancelAnimationFrame(holder.id);
  if (holder.timer !== null) clearTimeout(holder.timer);
  holder.id = null;
  holder.timer = null;
}

/** Ramp `el.volume` toward `target`. `holder` carries the in-flight ramp so a
 *  new ramp cancels the previous one (rapid toggling must not stack).
 *
 *  ⚠ The setTimeout is not redundant: rAF stops entirely in a backgrounded tab,
 *  and the loop seam runs unattended — a stalled ramp strands the volume and
 *  never fires `onDone`. Timer is throttled to ~1s there but it fires. */
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
      // ⚠ Clamped: the interpolation can land a hair outside [0,1] on float
      // error (observed -0.000221 fading to 0), and `HTMLMediaElement.volume`
      // THROWS on out-of-range rather than clamping.
      el.volume = Math.min(1, Math.max(0, from + (target - from) * t));
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

    // Ref resets per mount; the module flag it mirrors outlives one. Mute →
    // client-nav to `/pricing` → back would land with an audible bed and silent
    // clicks. Re-sync rather than assume.
    setSoundOn(!stoppedByUser.current);

    // Start silent; `onPlay` fades up, so the first note rides the same ramp
    // as a manual toggle.
    el.volume = 0;
    const holder = fade.current;
    const onPlay = () => {
      setPlaying(true);
      fadeTo(el, holder, VOLUME);
    };
    const onPause = () => {
      // A finished lap pauses briefly before `onEnded` restarts. Button must
      // not blink "off" for a seam — only a real stop reaches this.
      if (!el.ended) setPlaying(false);
    };

    const onTimeUpdate = () => {
      if (restarting.current || stoppedByUser.current) return;
      const { duration, currentTime } = el;
      // No metadata yet, or file too short for a full out-and-in ramp (would
      // be tremolo, not a bed). `onEnded` restarts those instead.
      if (!Number.isFinite(duration) || duration < LOOP_FADE_S * 2) return;
      if (duration - currentTime > LOOP_FADE_S) return;
      restarting.current = true;
      fadeTo(el, holder, 0, () => {
        el.currentTime = 0;
        restarting.current = false;
        // Muted mid-seam: toggle owns volume now and its ramp will pause us.
        if (!stoppedByUser.current) fadeTo(el, holder, VOLUME);
      });
    };

    // Backstop for paths `timeupdate` can't land: file shorter than the ramp,
    // throttled hidden tab, a toggle that cancelled the seam ramp mid-flight.
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

    /**
     * ⚠ NO visibility handler here, deliberately. A `fadeTo`-based one cannot
     * work: rAF stops the instant a tab hides, so its ramp lands via the
     * ~1s-clamped timer backstop and reads as a hold-then-CUT. The tab-hide
     * fade lives where it can actually run — the element is routed through the
     * shared context's master bus (below), and `audio-context.ts ›
     * armVisibility` ramps that bus on the AUDIO THREAD, which background
     * throttling cannot touch. The element keeps playing (silently, into a
     * suspended context) while hidden, so returning fades back in mid-track.
     * Re-adding a pause or `el.volume` fade on visibilitychange here would
     * fight that bus fade.
     *
     * ⚠ Routed via `routeMediaElement`, never a bare `createMediaElementSource`
     * here: that call is once-per-element FOREVER, and StrictMode's double
     * effect run makes a second call against the same element a certainty — the
     * bare version left the bed captured by a disconnected source, permanently
     * silent with a live-looking mute button. The helper caches the source per
     * element and reconnects on remount. `el.volume` still applies on the
     * routed path, so every ramp in this file (toggle, loop seam, start) works
     * unchanged on top of the bus.
     */
    const ac = audioContext();
    const bedSource = ac ? routeMediaElement(ac, el) : null;

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
      // Disconnect only — the source stays cached in audio-context for this
      // element, and the next mount reconnects it (see routeMediaElement).
      bedSource?.disconnect();
      cancelFade(holder);
      disarm();
    };
  }, []);

  /** ⚠ ONLY writer of `stoppedByUser`. `click-sound.tsx` reads the same intent
   *  via sound-preference, so bed + clicks must move together — mute has to
   *  silence both. Never set the ref at a call site. */
  const setStopped = (next: boolean) => {
    stoppedByUser.current = next;
    setSoundOn(!next);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    // `stoppedByUser` is the tiebreak for a toggle raced against a fade-out:
    // re-enabling mid-fade cancels the pending pause (onDone below checks it).
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
      {/* Instrumental, no speech — nothing to caption. */}
      {/* No `loop` attr: the effect above loops on a fade. */}
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
