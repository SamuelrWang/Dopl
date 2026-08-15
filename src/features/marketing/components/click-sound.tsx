"use client";

import { useEffect } from "react";
import { isSoundOn } from "../sound-preference";

/**
 * A short click under every button and link on the landing page. Rendered once,
 * at the page level (`src/app/page.tsx`), next to `<AmbientAudio />`.
 *
 * ── Synthesised, not a file ────────────────────────────────────────────────
 * There is no `/audio/click.mp3` and there should not be. An `<audio>` element
 * cannot overlap itself (a second click during the first restarts it), the first
 * press would wait on a network fetch and decode, and a single sample repeated a
 * few dozen times per visit starts to sound mechanical. Two oscillator-ish
 * layers built at press time overlap freely, cost no request, and can be jittered
 * per press so no two clicks are bit-identical.
 *
 * ── One listener on the document, not a prop on every button ──────────────
 * The landing tree has buttons in the nav, the hero, the plan cards and the
 * framework windows, and `/pricing` and `/get-started` reuse the same `.lp-btn`
 * markup. Threading an onClick through all of them would be the kind of change
 * that misses one. Delegation also means anything added to the page later is
 * covered without being told about this file.
 *
 * ── `pointerdown`, not `click` ────────────────────────────────────────────
 * `click` fires on RELEASE. A press-feedback sound that waits for the button to
 * come back up reads as lag, and it never fires at all for a press that drags
 * off the control. The down edge is the event the sound is describing.
 *
 * ── Scope is the landing page, and so is the mute ─────────────────────────
 * The speaker toggle that governs this lives in `<AmbientAudio />`, which is
 * mounted on the home page only, by the same reasoning recorded there. Mounting
 * clicks on `/pricing` or `/get-started` would put sound on a page with no
 * visible way to stop it, so this component follows the toggle rather than the
 * `.lp` stylesheet.
 */

/** Peak gain of the transient layer. Full scale is 1; the bed sits at 0.75 and a
 *  click that competes with it stops being punctuation. */
const CLICK_VOLUME = 0.2;

/** Centre of the bandpass on the noise burst, in Hz. Lower reads as a dull
 *  thock, higher as a sharp typewriter tick; this sits close to a keycap. */
const CLICK_PITCH_HZ = 2800;

/** How far the pitch wanders per press, as a fraction. Without it the ear starts
 *  hearing "the same sample again" after a handful of clicks. */
const PITCH_JITTER = 0.08;

/** Transient decay. Past ~50ms the ear stops filing it under "click". */
const CLICK_DECAY_S = 0.026;

/** The low sine under the transient, and its own decay — the weight that makes a
 *  press feel like it moved something rather than just ticked. */
const BODY_HZ = 170;
const BODY_VOLUME = 0.11;
const BODY_DECAY_S = 0.05;

/** 50ms of noise: the burst is windowed to `CLICK_DECAY_S` anyway, so a longer
 *  buffer is memory nobody hears. */
const NOISE_S = 0.05;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** One context for the page. A fresh `AudioContext` per press leaks graph nodes
 *  and Chrome hard-caps the count, so a chatty visitor would eventually get
 *  silence instead of clicks. Built on first press rather than at mount so the
 *  page does not open a suspended context it may never use. */
function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  // A context created before any gesture starts suspended, and a gesture-time
  // resume is exactly what the autoplay policy is waiting for. The only caller
  // is a pointerdown handler, so that condition is always met here.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Filled once and reused. Regenerating ~2200 random samples on every press is
 *  work the bandpass immediately throws most of away. */
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

  // Layer 1 — the transient. Band-passed noise, opened in 1ms and gone in ~26.
  const burst = ac.createBufferSource();
  burst.buffer = noiseBuffer(ac);

  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = CLICK_PITCH_HZ * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
  band.Q.value = 1.2;

  const burstGain = ac.createGain();
  // Ramps, not a bare `setValueAtTime`: a gain that steps straight to peak puts a
  // discontinuity in the waveform, which is itself an audible pop riding on top
  // of the click. `exponentialRamp` cannot reach 0, hence the epsilon floor.
  burstGain.gain.setValueAtTime(0, t);
  burstGain.gain.linearRampToValueAtTime(CLICK_VOLUME, t + 0.001);
  burstGain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_DECAY_S);

  burst.connect(band).connect(burstGain).connect(ac.destination);
  burst.start(t);
  burst.stop(t + CLICK_DECAY_S + 0.01);

  // Layer 2 — the body. A low sine dropping an octave over its short life, which
  // is what reads as weight rather than as a second tone.
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

  // Nodes are single-use and self-collect once stopped and disconnected; the
  // handler holds no reference to them, so nothing accumulates between presses.
}

/** What counts as a press worth sounding. */
function shouldClick(event: PointerEvent): boolean {
  // Secondary and middle buttons open menus and background tabs — neither is the
  // press this sound is describing. Touch and pen both report 0.
  if (event.button !== 0) return false;

  const target = event.target;
  if (!(target instanceof Element)) return false;

  const control = target.closest("button, a[href], [role='button']");
  if (!control) return false;

  // The speaker toggle is excluded for the same reason `<AmbientAudio />`
  // excludes it from its own gesture listener: the press that asks for silence
  // must not make a sound on the way there. It fires on the DOWN edge, before
  // the toggle's own `click` handler has flipped anything, so the mute check
  // below would not catch it.
  if (control.closest(".lp-audio-toggle")) return false;

  // A control that will not respond should not sound like it did.
  if (control.matches(":disabled, [aria-disabled='true']")) return false;

  return true;
}

export function ClickSound() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // Read at fire time, not at mount: the toggle may flip at any point and
      // this handler outlives every one of those flips.
      if (!isSoundOn()) return;
      if (!shouldClick(event)) return;
      playClick();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
