"use client";

import { useEffect, useRef, useState } from "react";
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

const VOLUME = 0.75;

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
