"use client";

import { useEffect } from "react";
import { isSoundOn } from "../sound-preference";

/**
 * Short click under every button/link on the landing page. Rendered once at
 * page level (`src/app/page.tsx`), beside `<AmbientAudio />`.
 *
 * ⚠ Synthesised, never a file. `<audio>` can't overlap itself (a second click
 * restarts the first), the first press would wait on fetch + decode, and one
 * repeated sample turns mechanical. Layers built at press time overlap freely
 * and jitter per press.
 *
 * ⚠ ONE delegated document listener, not a prop per button — the `.lp-btn`
 * markup is spread across nav, hero, plan cards, framework windows, `/pricing`
 * and `/get-started`. Delegation also covers anything added later.
 *
 * ⚠ `pointerdown`, not `click`. `click` fires on RELEASE: press feedback that
 * waits for the button to come up reads as lag, and never fires at all when a
 * press drags off the control.
 *
 * ⚠ Mount on the home page ONLY — the speaker toggle governing this lives in
 * `<AmbientAudio />`, also home-only. Clicks on `/pricing` or `/get-started`
 * would be sound with no visible way to stop it. Follow the toggle, not the
 * `.lp` stylesheet.
 */

/** Peak gain of the transient. Full scale is 1; bed sits at 0.75, and a click
 *  competing with it stops being punctuation. */
const CLICK_VOLUME = 0.2;

/** Bandpass centre, Hz. Lower = dull thock, higher = typewriter tick. */
const CLICK_PITCH_HZ = 2800;

/** Per-press pitch wander, as a fraction. Without it the ear hears "same
 *  sample again" after a handful of clicks. */
const PITCH_JITTER = 0.08;

/** Transient decay. Past ~50ms the ear stops filing it under "click". */
const CLICK_DECAY_S = 0.026;

/** Low sine under the transient — the weight that makes a press feel like it
 *  moved something. */
const BODY_HZ = 170;
const BODY_VOLUME = 0.11;
const BODY_DECAY_S = 0.05;

/** Burst is windowed to `CLICK_DECAY_S` anyway, so a longer buffer is memory
 *  nobody hears. */
const NOISE_S = 0.05;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** ⚠ ONE context for the page. A fresh `AudioContext` per press leaks graph
 *  nodes and Chrome hard-caps the count — a chatty visitor eventually gets
 *  silence. Built on first press, not at mount, to avoid opening a suspended
 *  context the page may never use. */
function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  // Pre-gesture contexts start suspended; a gesture-time resume is what the
  // autoplay policy wants. Sole caller is a pointerdown handler.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Filled once and reused — the bandpass throws most of ~2200 fresh random
 *  samples away anyway. */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const length = Math.floor(ac.sampleRate * NOISE_S);
  noise = ac.createBuffer(1, length, ac.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < length; i += 1) samples[i] = Math.random() * 2 - 1;
  return noise;
}

function playClick(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  // Layer 1 — transient: band-passed noise, open in 1ms, gone in ~26.
  const burst = ac.createBufferSource();
  burst.buffer = noiseBuffer(ac);

  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = CLICK_PITCH_HZ * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
  band.Q.value = 1.2;

  const burstGain = ac.createGain();
  // ⚠ Ramps, not bare `setValueAtTime`: a gain stepping straight to peak is a
  // waveform discontinuity, i.e. an audible pop over the click.
  // `exponentialRamp` cannot reach 0, hence the epsilon floor.
  burstGain.gain.setValueAtTime(0, t);
  burstGain.gain.linearRampToValueAtTime(CLICK_VOLUME, t + 0.001);
  burstGain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_DECAY_S);

  burst.connect(band).connect(burstGain).connect(ac.destination);
  burst.start(t);
  burst.stop(t + CLICK_DECAY_S + 0.01);

  // Layer 2 — body: low sine dropping an octave over its short life, which
  // reads as weight rather than a second tone.
  const body = ac.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(BODY_HZ, t);
  body.frequency.exponentialRampToValueAtTime(BODY_HZ / 2, t + BODY_DECAY_S);

  const bodyGain = ac.createGain();
  bodyGain.gain.setValueAtTime(0, t);
  bodyGain.gain.linearRampToValueAtTime(BODY_VOLUME, t + 0.002);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + BODY_DECAY_S);

  body.connect(bodyGain).connect(ac.destination);
  body.start(t);
  body.stop(t + BODY_DECAY_S + 0.01);

  // Nodes are single-use and self-collect once stopped; the handler holds no
  // reference, so nothing accumulates between presses.
}

/** What counts as a press worth sounding. */
function shouldClick(event: PointerEvent): boolean {
  // Secondary/middle open menus and background tabs. Touch and pen report 0.
  if (event.button !== 0) return false;

  const target = event.target;
  if (!(target instanceof Element)) return false;

  const control = target.closest("button, a[href], [role='button']");
  if (!control) return false;

  // ⚠ Speaker toggle excluded: the press asking for silence must not sound.
  // This fires on the DOWN edge, before the toggle's `click` flips anything,
  // so the isSoundOn() check would not catch it.
  if (control.closest(".lp-audio-toggle")) return false;

  // A control that won't respond should not sound like it did.
  if (control.matches(":disabled, [aria-disabled='true']")) return false;

  return true;
}

export function ClickSound() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // Read at fire time, not mount: this handler outlives every toggle flip.
      if (!isSoundOn()) return;
      if (!shouldClick(event)) return;
      playClick();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
