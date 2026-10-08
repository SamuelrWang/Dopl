"use client";

/**
 * **DICTATION FOR THE COMPOSER — the Mic glyph, wired** (Samuel, 2026-09-04; engines 2026-10-08).
 *
 * ⚠ **ONE INTERFACE, A REAL PROBE.** The hook drives whatever `dictation/select-engine.ts` picks —
 * the desktop's on-device recognizer, or the browser's own — and never asks "does a constructor
 * exist". It asks the ENGINE whether a click can work (`probe`), on mount, on every click, and
 * again when the window regains focus after a fault (the operator may just have flipped a switch
 * in System Settings). Until 2026-10-08 the check was presence-only, so the desktop app offered a
 * live-looking mic whose every click ended in "Dictation unavailable".
 *
 * ⚠ **RED MEANS LISTENING OR A FAULT, AND ONLY THE ENGINE MAY SAY LISTENING.** `listening` is set
 * from the engine's start event, never optimistically on the click.
 *
 * ⚠ **EVERY STOP KEEPS THE TEXT.** Finished phrases are APPENDED through `onPhrase`; a stop for any
 * reason (second click, window going away, the 60s cap, a fault) leaves them in the box, and a
 * phrase still only partial when the session ends is committed rather than dropped.
 *
 * ⚠ **PARTIALS ARE A PREVIEW, NOT DRAFT TEXT.** They re-word themselves as speech continues, so
 * they ride `partial` (the toolbar shows it beside the mic) and only finals touch the draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getDesktopDictation, isDesktopApp } from "@/shared/lib/desktop";
import type { DictationAvailability, DictationEngine, DictationSession } from "./dictation/engine";

interface Live {
  handle: DictationSession | null;
  ended: boolean;
  stopAsked: boolean;
}
import { isMacPlatform, type DictationFault } from "./dictation/faults";
import { selectEngine } from "./dictation/select-engine";
import { recognitionCtor } from "./dictation/web-engine";

/**
 * HOW LONG ONE DICTATION MAY RUN, unattended, before it stops itself. It is a hot microphone:
 * continuous recognition does not end on a pause. 60s is Samuel's number; main backs it up.
 */
const DICTATION_MAX_MS = 60_000;

export interface Dictation {
  /** Render the button at all. ⚠ FALSE ON THE SERVER AND ON THE FIRST CLIENT RENDER. */
  supported: boolean;
  /** The engine is capturing RIGHT NOW. */
  listening: boolean;
  /** Why dictation cannot run or just stopped, in a few words, or null. Persists past the stop;
   *  clears when the next attempt starts. */
  error: string | null;
  /** What to do about `error`, or null. The tooltip's second line. */
  hint: string | null;
  /** The phrase being spoken, not yet final. "" when none. */
  partial: string;
  toggle: () => void;
}

/** A string key for the engine choice, so the snapshot is stable across renders. */
function engineKey(): string {
  if (isDesktopApp()) return getDesktopDictation() ? "desktop-native" : "desktop-outdated";
  return recognitionCtor() ? "web" : "none";
}

function buildEngine(key: string): DictationEngine | null {
  if (key === "none") return null;
  return selectEngine({
    isDesktop: key.startsWith("desktop"),
    bridge: key === "desktop-native" ? getDesktopDictation() : null,
    webCtor: key === "web" ? recognitionCtor() : null,
    mac: isMacPlatform(),
  });
}

function language(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
}

/** Run `fn` with the answer now if it is synchronous, else when it arrives. */
function whenReady(
  answer: DictationAvailability | Promise<DictationAvailability>,
  fn: (a: DictationAvailability) => void
): void {
  if (answer instanceof Promise) void answer.then(fn, () => {});
  else fn(answer);
}

/**
 * @param onPhrase Called with each FINISHED phrase, trimmed and never empty. The caller owns where
 * it lands; this hook holds no copy of the draft.
 */
export function useDictation(onPhrase: (text: string) => void): Dictation {
  // ⚠ READ THROUGH `useSyncExternalStore` (a hydration rule): the server snapshot is "none", the
  // client's is the real choice, so both ends render the same markup first.
  const key = useSyncExternalStore(
    () => () => {},
    engineKey,
    () => "none"
  );
  const engine = useMemo(() => buildEngine(key), [key]);

  const [listening, setListening] = useState(false);
  const [fault, setFault] = useState<DictationFault | null>(null);
  const [partial, setPartial] = useState("");
  /** The live session's token. Handlers check identity against it, so a late event from an
   *  ended session can never touch the next one's state. */
  const session = useRef<Live | null>(null);
  const starting = useRef(false);
  const pendingPartial = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ⚠ THE CALLBACK THROUGH A REF so the composer's inline closure does not re-create `start`/`stop`
  // on every keystroke and tear the session down mid-sentence.
  const phrase = useRef(onPhrase);
  useEffect(() => {
    phrase.current = onPhrase;
  });

  const deliver = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length > 0) phrase.current(trimmed);
  }, []);

  /** Idempotent and safe from any state: the click, three events and unmount all call it. */
  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const me = session.current;
    if (!me) return;
    me.stopAsked = true;
    me.handle?.stop();
  }, []);

  const begin = useCallback(() => {
    if (!engine) return;
    pendingPartial.current = "";
    setPartial("");
    const me: Live = { handle: null, ended: false, stopAsked: false };
    session.current = me;
    const isMine = () => session.current === me && !me.ended;
    // ⚠ THE TOKEN IS SET BEFORE `start`, because an engine may answer synchronously (the browser
    // fires `onstart` inside `start()`; an unavailable engine faults and ends inside it).
    me.handle = engine.start(language(), {
      onStart: () => {
        if (isMine()) setListening(true);
      },
      onPartial: (text) => {
        if (!isMine()) return;
        pendingPartial.current = text;
        setPartial(text.trim());
      },
      onFinal: (text) => {
        if (!isMine()) return;
        pendingPartial.current = "";
        setPartial("");
        deliver(text);
      },
      onFault: (f) => {
        if (isMine()) setFault(f);
      },
      onEnd: () => {
        if (!isMine()) return;
        me.ended = true;
        // A phrase still partial at the end is the operator's words: keep them.
        deliver(pendingPartial.current);
        pendingPartial.current = "";
        session.current = null;
        if (timer.current !== null) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        setPartial("");
        setListening(false);
      },
    });
    if (me.ended) return;
    if (me.stopAsked) {
      me.handle.stop();
      return;
    }
    timer.current = setTimeout(stop, DICTATION_MAX_MS);
  }, [engine, deliver, stop]);

  const start = useCallback(() => {
    if (!engine || session.current !== null || starting.current) return;
    // ⚠ CLEARED AT THE START OF AN ATTEMPT, never at its end: a reason cleared on the way out is
    // the one-frame blink Samuel reported (2026-09-08).
    setFault(null);
    starting.current = true;
    whenReady(engine.probe(), (answer) => {
      starting.current = false;
      if (!answer.ok) {
        setFault(answer.fault);
        return;
      }
      begin();
    });
  }, [engine, begin]);

  // The mount probe: an unavailable engine says so BEFORE the first click.
  useEffect(() => {
    if (!engine) return;
    let live = true;
    whenReady(engine.probe(), (answer) => {
      if (live && !answer.ok && session.current === null) setFault(answer.fault);
    });
    return () => {
      live = false;
    };
  }, [engine]);

  // After a fault, coming back to the window re-asks: the fix usually happens in System Settings.
  useEffect(() => {
    if (!engine || fault === null) return;
    const recheck = () => {
      if (session.current !== null || starting.current) return;
      whenReady(engine.probe(), (answer) => {
        if (session.current === null) setFault(answer.ok ? null : answer.fault);
      });
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [engine, fault]);

  // The window going away stops it: `blur` for another app, `visibilitychange` for another tab.
  // Bound only while listening, so an idle composer carries no listeners.
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

  // Unmount is a stop: a composer that navigates away must not leave the mic open behind it.
  useEffect(() => stop, [stop]);

  const toggle = useCallback(() => {
    if (session.current !== null) stop();
    else start();
  }, [start, stop]);

  return {
    supported: engine !== null,
    listening,
    error: fault?.reason ?? null,
    hint: fault?.fix ?? null,
    partial,
    toggle,
  };
}
