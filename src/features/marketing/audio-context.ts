/**
 * Shared Web Audio plumbing for the landing page: one context, one noise well.
 *
 * ⚠ ONE context per page, always. Chrome hard-caps how many a document may hold
 * and charges each an audio thread — a page that opens one per sound source
 * eventually goes silent and cannot say why. Both the button click
 * (`components/click-sound.tsx`) and the banner hum (`banner-hum.ts`) come
 * through here.
 */

let ctx: AudioContext | null = null;

/** Noise keyed by length in seconds — a one-shot transient and a looping bed
 *  want very different buffers, and neither wants regenerating per use. */
const noiseCache = new Map<number, AudioBuffer>();

let disarmUnlock: (() => void) | null = null;

/**
 * ⚠ SCROLL IS NOT USER ACTIVATION. A click unlocks audio because the press
 * itself is the gesture; the banner hum is driven by scroll, which is not, so a
 * visitor who lands and scrolls straight down has given the page nothing to
 * resume a suspended context with.
 *
 * So the first call that finds itself suspended leaves a one-shot listener
 * behind: the next real gesture anywhere resumes it and everything already
 * wired up becomes audible. Until then the graph runs into a suspended
 * destination — silent and cheap, and no caller has to branch on it.
 */
function armUnlock(ac: AudioContext): void {
  if (disarmUnlock) return;
  const unlock = () => {
    void ac.resume();
    disarmUnlock?.();
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
  disarmUnlock = () => {
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    disarmUnlock = null;
  };
}

/** The page's MASTER BUS — every sound source (clicks, hum, AND the ambient
 *  bed, routed in via `createMediaElementSource` in ambient-audio.tsx) connects
 *  here instead of `ac.destination`. It exists for exactly one reason: the
 *  visibility fade below has to attenuate everything at once, on the audio
 *  thread. */
let master: GainNode | null = null;

/** Where sources connect. Never `ac.destination` directly — a source wired
 *  straight to the destination is deaf to the visibility fade. */
export function audioBus(ac: AudioContext): AudioNode {
  if (!master) {
    master = ac.createGain();
    master.gain.value = 1;
    master.connect(ac.destination);
  }
  return master;
}

/** One source node per media element, EVER — `createMediaElementSource` both
 *  permanently captures the element's output and throws on a second call for
 *  the same element. React's dev StrictMode makes that second call a certainty
 *  (mount → cleanup → mount against the same DOM node), and the failure mode is
 *  vicious: the element stays captured by the first, now-disconnected source
 *  and goes permanently silent while `play()` and volume keep "working". So the
 *  source is cached per element and re-CONNECTED on later mounts instead of
 *  recreated. */
const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/** Route a media element through the master bus. Returns the source (call
 *  `.disconnect()` on unmount — the cache keeps it for the next mount), or null
 *  where routing failed and the element still has its DIRECT output. */
export function routeMediaElement(
  ac: AudioContext,
  el: HTMLMediaElement,
): MediaElementAudioSourceNode | null {
  try {
    let source = mediaSources.get(el);
    if (!source) {
      source = ac.createMediaElementSource(el);
      mediaSources.set(el, source);
    }
    source.connect(audioBus(ac));
    return source;
  } catch {
    return null;
  }
}

/** How long leaving/returning to the tab fades the page's sound. Matches the
 *  bed's own toggle ramp (`ambient-audio.tsx` › FADE_MS) closely enough that
 *  the two read as one behavior. */
const VISIBILITY_FADE_S = 0.6;

let suspendTimer: number | null = null;

/**
 * ⚠ A hidden tab must be a SILENT tab — but it must GET there on a fade, not a
 * cut. The subtlety: NOTHING rAF- or timer-driven can run that fade — rAF stops dead in a hidden
 * tab and timers clamp to ~1s. The one scheduler that keeps running is the
 * audio thread itself, so the fade is a `linearRampToValueAtTime` on the master
 * bus, scheduled in the same tick the tab hides. The context is then suspended
 * by a timer that fires AFTER the ramp has landed — the clamp that makes timers
 * useless for fading makes this one harmless, since by then the bus is silent
 * and suspending is inaudible. Return is the mirror: resume first (allowed
 * programmatically once a real gesture has ever unlocked the context), then
 * ramp the bus back up.
 *
 * The bed rides this bus too, so it fades with everything else and keeps
 * ADVANCING silently while hidden — coming back resumes mid-track, faded in,
 * exactly like the mute toggle sounds.
 */
function armVisibility(ac: AudioContext): void {
  document.addEventListener("visibilitychange", () => {
    const bus = audioBus(ac) as GainNode;
    if (suspendTimer !== null) {
      window.clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    if (document.hidden) {
      const t = ac.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + VISIBILITY_FADE_S);
      suspendTimer = window.setTimeout(() => {
        suspendTimer = null;
        // Re-checked: a quick tab-flip back must not suspend a visible page.
        if (document.hidden && ac.state === "running") void ac.suspend();
      }, VISIBILITY_FADE_S * 1000 + 250);
    } else {
      void ac
        .resume()
        .then(() => {
          const t = ac.currentTime;
          bus.gain.cancelScheduledValues(t);
          bus.gain.setValueAtTime(bus.gain.value, t);
          bus.gain.linearRampToValueAtTime(1, t + VISIBILITY_FADE_S);
        })
        .catch(() => {});
    }
  });
}

/** The page's context, or null where there is none (SSR). Callers treat null as
 *  "no sound", never as an error — a landing page missing a hum is not broken.
 *  Built on first demand so a visitor who triggers nothing opens no audio
 *  thread. */
export function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    armVisibility(ctx);
  }
  // Not while hidden: the visibility handler owns the suspend there, and a
  // resume from a caller (the hum ticking in a backgrounded tab) would undo it.
  if (ctx.state === "suspended" && !document.hidden) {
    void ctx.resume();
    armUnlock(ctx);
  }
  return ctx;
}

/** White noise `seconds` long, generated once per length. Loopers want a long
 *  buffer — a short one repeats fast enough for the ear to lock onto the period,
 *  and a loop you can hear the seam of stops being noise. */
export function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const cached = noiseCache.get(seconds);
  if (cached) return cached;
  const length = Math.floor(ac.sampleRate * seconds);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) samples[i] = Math.random() * 2 - 1;
  noiseCache.set(seconds, buffer);
  return buffer;
}
