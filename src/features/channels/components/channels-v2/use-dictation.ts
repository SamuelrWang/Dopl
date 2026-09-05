"use client";

/**
 * **DICTATION FOR THE COMPOSER — the Mic glyph, wired** (Samuel, 2026-09-04).
 *
 * ⚠ **THE BROWSER'S OWN ENGINE, AND NOTHING IS INSTALLED.** `SpeechRecognition` (`webkit`-prefixed
 * everywhere that ships it today) hands the audio to the browser's service — Chrome to Google's,
 * Safari to Apple's dictation — so there is no key, no billing and no new dependency. It also means
 * the audio leaves the machine by a path this app neither opens nor controls, which is the browser's
 * contract with its user and the reason the permission prompt is theirs to answer.
 *
 * ⚠ **IT IS NOT IN `lib.dom.d.ts`**, so the shapes below are declared locally and DELIBERATELY
 * MINIMAL: exactly the members this file touches, nothing speculative. A `declare global` widening
 * of `Window` would put a half-specified vendor API into every file's namespace; the cast is
 * confined to {@link recognitionCtor}.
 *
 * ⚠ **RED MEANS LISTENING, AND ONLY THE ENGINE MAY SAY SO.** `listening` is set from `onstart` —
 * the event that fires when capture actually begins — never optimistically on the click. A denied
 * microphone raises `onerror` and no `onstart`, so the button never reddens for a session that is
 * not happening, which is the one thing a recording indicator must never get wrong.
 *
 * ⚠ **EVERY STOP KEEPS THE TEXT.** Nothing here clears or rewrites the draft: the hook only ever
 * APPENDS finished phrases through its callback, so a stop for any reason — a second click, the tab
 * going away, the 60-second cap, an engine error — leaves the words in the box and the operator
 * clicks again to carry on. There is no "discard on stop" path to get wrong.
 *
 * ⚠ **FINAL RESULTS ONLY** (`interimResults = false`). Interim hypotheses arrive as re-sent,
 * re-worded prefixes; appending them into a draft the operator is also typing into produces
 * duplicated half-sentences, and the only way to keep them clean is to own a replaceable region of
 * the draft — state this hook deliberately does not have (the draft belongs to the composer).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * HOW LONG ONE DICTATION MAY RUN, unattended, before it stops itself.
 *
 * ⚠ IT IS A HOT MICROPHONE, WHICH IS WHY THERE IS A CAP AT ALL. `continuous` recognition does not
 * end on a pause, so a click and a walk away would leave the mic open for as long as the tab lives.
 * 60s is Samuel's number; the operator clicks again for another minute and the draft is untouched.
 */
const DICTATION_MAX_MS = 60_000;

/** One hypothesis for one phrase. Only the best (`[0]`) is ever read. */
interface RecognitionAlternative {
  transcript: string;
}

/** One phrase. ⚠ `isFinal` is the whole gate — see the header on interim results. */
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative | undefined;
}

interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult | undefined;
}

/** ⚠ `resultIndex` IS LOAD-BEARING: the list is cumulative for the whole session, so a reader that
 *  starts at 0 re-appends every phrase already in the draft on every event. */
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}

interface RecognitionErrorEvent {
  readonly error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

/**
 * The constructor this browser ships, or `null`.
 *
 * ⚠ CAPABILITY-KEYED, never a user-agent test — the same detection rule every bridge affordance in
 * this family follows. Firefox ships neither name and gets `null`, which the caller renders as NO
 * BUTTON rather than a dead one.
 */
function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  /** ⚠ FALSE ON THE SERVER AND ON THE FIRST CLIENT RENDER — see the effect below. */
  supported: boolean;
  /** The engine is capturing RIGHT NOW. The button's red is this and nothing else. */
  listening: boolean;
  toggle: () => void;
}

/**
 * @param onPhrase Called with each FINISHED phrase, trimmed and never empty. The caller owns where
 * it lands; this hook holds no copy of the draft.
 */
export function useDictation(onPhrase: (text: string) => void): Dictation {
  /**
   * ⚠ READ THROUGH `useSyncExternalStore`, AND THAT IS A HYDRATION RULE. This tree renders on
   * the server, where `window` does not exist and the honest answer is `false`; initialising from
   * `recognitionCtor()` would make the server say "no button" and the first client render say
   * "button", which is a hydration mismatch React resolves by shouting. The SERVER snapshot is
   * `false` and the client snapshot is the real probe, so both ends render the same markup and
   * the truth arrives on hydration. This was an effect calling `setSupported` until 2026-09-05
   * — same two values in the same order, without a render-triggering write inside an effect.
   */
  const supported = useSyncExternalStore(
    // Never changes after load: subscribe to nothing, unsubscribe with nothing.
    () => () => {},
    () => recognitionCtor() !== null,
    () => false
  );

  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ⚠ THE CALLBACK THROUGH A REF so a caller passing an inline closure — which the composer does,
   *  because it appends into `draft` — does not re-create `start`/`stop` on every keystroke and
   *  tear down the listeners keyed on them mid-sentence. */
  const phrase = useRef(onPhrase);
  useEffect(() => {
    phrase.current = onPhrase;
  });

  /** ⚠ IDEMPOTENT AND SAFE FROM ANY STATE: it is called by the click, by three different events and
   *  by unmount, sometimes twice for one stop (`stop()` then the engine's own `onend`). */
  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const active = recognition.current;
    recognition.current = null;
    setListening(false);
    // ⚠ GUARDED: `stop()` on an engine that has already ended throws in some builds, and this is
    // the unmount path as well — an exception here would take the composer down with it.
    if (active !== null) {
      try {
        active.stop();
      } catch {
        // Already finished. The state above is what matters and it is already correct.
      }
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (Ctor === null || recognition.current !== null) return;
    let engine: SpeechRecognitionLike;
    try {
      engine = new Ctor();
    } catch {
      return;
    }
    engine.continuous = true;
    engine.interimResults = false;
    // The operator's own locale, with the browser's default as the fallback.
    engine.lang =
      typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    // ⚠ THE ONLY PLACE `listening` GOES TRUE — see the header's note on red.
    engine.onstart = () => setListening(true);
    engine.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) text += result[0]?.transcript ?? "";
      }
      const trimmed = text.trim();
      if (trimmed.length > 0) phrase.current(trimmed);
    };
    // ⚠ AN ERROR IS A STOP, NOT A MESSAGE. `not-allowed` (permission refused), `no-speech`,
    // `network` — the operator's own browser already tells them about the first, and the honest
    // signal for the rest is the button going quiet. Nothing typed is touched.
    engine.onerror = () => stop();
    // ⚠ THE ENGINE ENDS ON ITS OWN TOO — a `continuous` session still terminates on some engines
    // after a long silence — and the button must follow it rather than lie about a dead mic.
    engine.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = engine;
    try {
      engine.start();
    } catch {
      // Already started, or refused outright. Never leave a half-armed engine behind.
      recognition.current = null;
      return;
    }
    timer.current = setTimeout(stop, DICTATION_MAX_MS);
  }, [stop]);

  /**
   * ⚠ THE TAB GOING AWAY STOPS IT. A microphone that stays hot while the operator is in another
   * window is the failure everyone remembers, and neither event alone covers it: `blur` catches a
   * switch to another app or window, `visibilitychange` catches a switch to another TAB, which does
   * not always blur. Bound only WHILE listening, so an idle composer carries no listeners.
   */
  useEffect(() => {
    if (!listening) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [listening, stop]);

  /** ⚠ UNMOUNT IS A STOP. `stop` is stable, so this cleanup runs once, on the way out — a composer
   *  that navigates away must not leave the mic open behind it. */
  useEffect(() => stop, [stop]);

  const toggle = useCallback(() => {
    if (recognition.current !== null) stop();
    else start();
  }, [start, stop]);

  return { supported, listening, toggle };
}
