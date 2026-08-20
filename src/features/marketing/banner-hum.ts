import { audioBus, audioContext, noiseBuffer } from "./audio-context";
import { isSoundOn } from "./sound-preference";
import { clamp01, ramp } from "./motion";

/**
 * Low generator hum under the banner's glass panel as it expands (see
 * components/use-banner-scrub.ts, EXPAND_START→EXPAND_END).
 *
 * ⚠ A GENERATOR, NOT AN ENGINE. The distinction is the whole brief, and three
 * things carry it:
 *
 *   FIXED PITCH       the fundamental does not move AT ALL, and neither does
 *                     the lowpass corner — even a ~2-semitone drift or an
 *                     opening filter reads as a rev. The whole of "the panel is
 *                     opening" is carried by partials fading in — thickening,
 *                     never sharpening — and all blooms finish by
 *                     ~mid-expansion so the back half is dead constant.
 *   SINES, LOW ORDER  fundamental plus 2nd/3rd/4th, the spectrum of a
 *                     transformer or a motor housing. No sawtooth — a saw
 *                     carries every harmonic at once, which is engine buzz.
 *   NO RESONANCE      the master lowpass runs Q 0.5. A resonant filter sweep is
 *                     exactly the "vrooom" this must not be.
 *
 * What sells "generator" instead of "tone" is the LOPE: a slow 0.7Hz amplitude
 * wobble, plus low-passed noise for housing rumble. Deliberately slow — fast
 * tremolo reads as a "brrr" motor.
 *
 * ── Why this is a throttle and not a sound effect ──────────────────────────
 * The expansion is SCROLL-SCRUBBED. It has no duration: a wheel flick runs it in
 * 200ms, a trackpad crawl takes ten seconds, and either can stall mid-way or
 * reverse. A one-shot clip fired at EXPAND_START would be right roughly never.
 * So:
 *
 *   POSITION → PRESENCE   how far the panel has grown sets which upper
 *                         harmonics have bloomed — and nothing else. Scrolling
 *                         back walks them down, so a reversed scrub needs no
 *                         special case.
 *   VELOCITY → SWELL      how fast it grows sets loudness ABOVE a floor. A
 *                         generator does not stop when you stop looking at it,
 *                         so `SUSTAIN` keeps it running while the panel is
 *                         mid-open and movement pushes it louder.
 *
 * ⚠ THE TICKER HAS TO BE OURS. `update()` is called from the scrub's rAF, which
 * only runs while scroll events arrive. Decaying loudness there would strand the
 * voice at whatever the last frame left the moment a scroll stopped. This module
 * runs its own rAF while audible, treats an `update()` older than STALE_S as
 * "not scrolling", and rides its own release down.
 */

/**
 * Peak master gain. Low frequencies need far more amplitude than mid-range for
 * the same perceived loudness, and this plays under a bed re-mastered +14.5 dB,
 * so it reads enormous next to the click's 0.2 and still sits below it.
 *
 * ⚠ Values above ~0.85 are only legal because of the COMPRESSOR — see `build`.
 * The partial gains sum to 0.985 and the rumble adds 0.09; harmonically-related
 * sines line up in phase, so the stack's instantaneous peak really can approach
 * that sum rather than averaging out. Bare, a master much above 0.85 would
 * drive `destination` past full scale and Web Audio hard-clips there — crackle
 * on the loudest part of the swell, not "too loud". The compressor catches
 * those peaks and turns the overdrive into loudness instead. Remove it and this
 * number must come back under ~0.85.
 */
const HUM_VOLUME = 1.35;

/** The fundamental. FIXED — see the header.
 *
 *  ⚠ Do not drop below ~55 Hz: under that the note is at or below where most
 *  headphones and every laptop speaker roll off, and the hum vanishes on real
 *  hardware, leaving only faint upper partials. Mains-hum territory (50–60 Hz)
 *  is both the right reference for a generator AND the lowest that reliably
 *  reproduces. */
const FUND_HZ = 62;

/**
 * Harmonic stack. `bloom` is the expansion at which a partial starts fading in,
 * so the panel opening thickens the hum rather than pitching it up.
 * ⚠ All blooms must finish by ~half-expansion (last starts 0.28, ramp 0.24 →
 * done at 0.52): the back half of the growth stays spectrally DEAD, because a
 * late-arriving partial reads as an end-of-growth pitch rise. */
const PARTIALS = [
  { ratio: 1, gain: 0.5, type: "sine", bloom: 0 },
  { ratio: 2, gain: 0.3, type: "sine", bloom: 0.06 },
  { ratio: 3, gain: 0.13, type: "triangle", bloom: 0.16 },
  { ratio: 4, gain: 0.055, type: "sine", bloom: 0.28 },
] as const;

/** How long a partial takes to fade in past its bloom point. */
const BLOOM_RAMP = 0.24;

/** Master lowpass. FIXED — a corner that opens with the growth brightens the
 *  voice, which the ear files under "pitch going up" even at constant Hz. 460
 *  keeps the 2nd/3rd harmonics (~124/186 Hz, what small drivers actually
 *  reproduce) inside the passband from the first frame. The Q is the single
 *  setting that most decides generator vs. vehicle, and it should not rise. */
const CUTOFF_HZ = 460;
const CUTOFF_Q = 0.5;

/** The lope: slow amplitude wobble, the unevenness of something mechanical
 *  turning over. ⚠ Keep the rate under ~1Hz — above that it stops being a
 *  generator and becomes a tremolo effect. */
const LOPE_HZ = 0.7;
const LOPE_DEPTH = 0.09;

/** Housing rumble: noise under a steep lowpass. Adds the broadband floor a pure
 *  harmonic stack lacks. */
const RUMBLE_LOWPASS_HZ = 220;
const RUMBLE_MIX = 0.09;
const RUMBLE_NOISE_S = 2;

/** Growth rate, in expansion-units per second, at which the swell saturates. */
const VELOCITY_FULL = 1.1;

/** Loudness held while the panel is mid-open but nothing is moving, as a
 *  fraction of peak. ⚠ This floor IS the common case — the swell above it only
 *  reaches full while the wheel is actually moving — so loudness changes must
 *  move it together with `HUM_VOLUME`. Set to 0 to cut out whenever scrolling
 *  stops. */
const SUSTAIN = 0.72;

/** An `update()` older than this means scrolling stopped, whatever the last
 *  measured velocity was. ~5 frames: long enough not to trip on a dropped one. */
const STALE_S = 0.09;

/** Loudness smoothing time constants. Slow — a hum that snaps sounds like a
 *  switch being thrown. */
const ATTACK_TAU_S = 0.14;
const RELEASE_TAU_S = 0.55;

/** Below this the voice is inaudible; park the ticker rather than burn a frame
 *  callback forever. */
const SILENCE = 0.0004;

/** ⚠ Smoothing on every AudioParam write. Assigning `.value` per frame steps the
 *  parameter, and a stepped sweep zippers audibly. */
const PARAM_TAU_S = 0.04;

type Voice = {
  ac: AudioContext;
  oscs: OscillatorNode[];
  gains: GainNode[];
  cutoff: BiquadFilterNode;
  rumble: AudioBufferSourceNode;
  lope: OscillatorNode;
  master: GainNode;
  limiter: DynamicsCompressorNode;
};

/**
 * Build the graph, running, with the master shut. ⚠ Everything starts once and
 * stays running for the life of the scene: an `OscillatorNode` is single-use —
 * `stop()` is terminal and a stopped one cannot restart — so the alternative is
 * rebuilding on every entry into the expansion, which is node churn mid-scroll
 * for no gain. Idling at zero gain costs microseconds per frame.
 */
function build(ac: AudioContext): Voice {
  const master = ac.createGain();
  master.gain.value = 0;

  /**
   * ⚠ The compressor is what makes `HUM_VOLUME` above ~0.85 safe — it is a
   * limiter here, not a tone choice. The master deliberately overdrives it and
   * it squashes the in-phase peaks that would otherwise hard-clip at the
   * destination, converting headroom violations into perceived loudness. The
   * knee is soft and the ratio high so it grabs cleanly rather than pumping;
   * attack is fast enough to catch the lope's crest. It only touches THIS
   * voice's path — the bed and the click do not route through it.
   */
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -20;
  limiter.knee.value = 12;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;
  master.connect(limiter).connect(audioBus(ac));

  // The lope sits between the mix and the master: a gain offset by a constant
  // and modulated by a slow LFO around it.
  const lopeGain = ac.createGain();
  lopeGain.gain.value = 1 - LOPE_DEPTH;
  const lope = ac.createOscillator();
  lope.type = "sine";
  lope.frequency.value = LOPE_HZ;
  const lopeDepth = ac.createGain();
  lopeDepth.gain.value = LOPE_DEPTH;
  lope.connect(lopeDepth).connect(lopeGain.gain);
  lopeGain.connect(master);

  const cutoff = ac.createBiquadFilter();
  cutoff.type = "lowpass";
  cutoff.frequency.value = CUTOFF_HZ;
  cutoff.Q.value = CUTOFF_Q;
  cutoff.connect(lopeGain);

  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  PARTIALS.forEach((partial) => {
    const osc = ac.createOscillator();
    osc.type = partial.type;
    osc.frequency.value = FUND_HZ * partial.ratio;

    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(cutoff);

    oscs.push(osc);
    gains.push(gain);
  });

  // Housing rumble.
  const rumbleLp = ac.createBiquadFilter();
  rumbleLp.type = "lowpass";
  rumbleLp.frequency.value = RUMBLE_LOWPASS_HZ;
  const rumbleMix = ac.createGain();
  rumbleMix.gain.value = RUMBLE_MIX;
  rumbleLp.connect(rumbleMix).connect(cutoff);

  const rumble = ac.createBufferSource();
  rumble.buffer = noiseBuffer(ac, RUMBLE_NOISE_S);
  rumble.loop = true;
  rumble.connect(rumbleLp);

  const now = ac.currentTime;
  oscs.forEach((osc) => osc.start(now));
  rumble.start(now);
  lope.start(now);

  return { ac, oscs, gains, cutoff, rumble, lope, master, limiter };
}

export type BannerHum = {
  /** Called from the scrub's render with the eased expansion progress, 0→1.
   *  Safe at any progress and any rate, including not at all. */
  update: (expansion: number) => void;
  /** Stop and release the graph. Call from the scrub effect's cleanup. */
  dispose: () => void;
};

export function createBannerHum(): BannerHum {
  let voice: Voice | null = null;
  let disposed = false;
  let raf = 0;

  let expansion = 0;
  let lastExpansion = 0;
  let lastUpdateMs = 0;
  let velocity = 0;

  let energy = 0;
  let lastTickMs = 0;

  const tick = () => {
    raf = 0;
    if (disposed || !voice) return;

    const now = performance.now();
    const frameS = lastTickMs ? Math.min(0.1, (now - lastTickMs) / 1000) : 1 / 60;
    lastTickMs = now;

    const stale = (now - lastUpdateMs) / 1000 > STALE_S;
    const target = stale ? 0 : clamp01(velocity / VELOCITY_FULL);

    // ⚠ Time-based smoothing, so the curve is identical on a 60Hz and a 120Hz
    // display. A per-frame lerp constant would run twice as fast on the latter.
    const tau = target > energy ? ATTACK_TAU_S : RELEASE_TAU_S;
    energy += (target - energy) * (1 - Math.exp(-frameS / tau));

    // Silent at both ends: nothing has started at 0, and at 1 the panel has
    // arrived. Between them the hum holds at SUSTAIN, movement swells it.
    const window = Math.sin(Math.PI * clamp01(expansion));
    const swell = SUSTAIN + (1 - SUSTAIN) * energy;
    const level = isSoundOn() ? HUM_VOLUME * window * swell : 0;

    const { ac } = voice;
    const t = ac.currentTime;
    voice.master.gain.setTargetAtTime(level, t, PARAM_TAU_S);

    // ⚠ GAINS ONLY. Frequencies and the cutoff are set once at build and never
    // written here — the fixed pitch is the point (see the header), and the one
    // scrubbed tone dimension left is which partials have bloomed.
    PARTIALS.forEach((partial, i) => {
      const bloomed = ramp(expansion, partial.bloom, partial.bloom + BLOOM_RAMP);
      voice?.gains[i]?.gain.setTargetAtTime(partial.gain * bloomed, t, PARAM_TAU_S);
    });

    // ⚠ Park once nothing is left to hear or fade. `setTargetAtTime` is
    // asymptotic and never truly lands, so pin the gain flat on the way out or
    // the graph keeps a hair of signal forever. The `level` check matters: with
    // SUSTAIN above 0 a stalled scroll mid-expansion is still audible, so a
    // spent `energy` alone is not grounds to stop.
    if (energy < SILENCE && target === 0 && level < SILENCE) {
      energy = 0;
      lastTickMs = 0;
      voice.master.gain.cancelScheduledValues(t);
      voice.master.gain.setValueAtTime(0, t);
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  // ⚠ bfcache revival — same rationale as use-banner-scrub.ts › onPageShow: a
  // rAF id latched in `raf` when the page froze may name a callback the engine
  // discarded, and then `update`'s `if (!raf)` never re-arms the ticker. The
  // stale timing baseline goes with it, or the first post-restore frame would
  // measure a minutes-long dt.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    raf = 0;
    lastTickMs = 0;
    lastUpdateMs = 0;
  };
  window.addEventListener("pageshow", onPageShow);

  const update = (next: number) => {
    if (disposed) return;

    const now = performance.now();
    const dt = (now - lastUpdateMs) / 1000;
    // ⚠ First call after a park has no baseline — a dt measured against a stamp
    // from minutes ago reads as zero velocity and swallows the first frame of a
    // fast scroll into the scene.
    if (lastUpdateMs && dt > 0 && dt < 0.5) {
      velocity = Math.abs(next - lastExpansion) / dt;
    }
    lastExpansion = next;
    lastUpdateMs = now;
    expansion = next;

    // Nothing to do until the panel is mid-expansion, and nothing to build
    // either — a visitor who never reaches the banner never opens a context.
    // (`>= 1` is the settled end state, reached and held on every pass.)
    if (next <= 0 || next >= 1) {
      if (!voice) return;
    } else if (!voice) {
      const ac = audioContext();
      if (!ac) return;
      voice = build(ac);
    }

    if (!raf) raf = requestAnimationFrame(tick);
  };

  const dispose = () => {
    disposed = true;
    window.removeEventListener("pageshow", onPageShow);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!voice) return;
    const { ac } = voice;
    const t = ac.currentTime;
    // Ramp before stopping: cutting a running graph at whatever sample it
    // happens to be on is a click.
    voice.master.gain.cancelScheduledValues(t);
    voice.master.gain.setTargetAtTime(0, t, 0.04);
    const stopAt = t + 0.25;
    voice.oscs.forEach((osc) => osc.stop(stopAt));
    voice.rumble.stop(stopAt);
    voice.lope.stop(stopAt);
    const dying = voice;
    voice = null;
    // Both stages: dropping only the master would leave the limiter attached to
    // the destination as a silent zombie node.
    window.setTimeout(() => {
      dying.master.disconnect();
      dying.limiter.disconnect();
    }, 320);
  };

  return { update, dispose };
}
