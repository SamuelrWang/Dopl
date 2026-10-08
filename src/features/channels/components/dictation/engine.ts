/**
 * ONE DICTATION ENGINE INTERFACE (2026-10-08). The composer's hook (`../use-dictation.ts`) drives
 * whichever engine `select-engine.ts` picks and never knows which one it has:
 *
 * - `macos-native`: the desktop app's on-device recognizer (`native-engine.ts` → main →
 *   `dopl-desktop-app/native/dictation/main.swift`). Free, no key, audio stays on the Mac.
 * - `web-speech`: the browser's own `SpeechRecognition` (`web-engine.ts`). Chrome only in
 *   practice; NEVER used inside the desktop app, whose Chromium has no Google speech key.
 * - `unavailable`: no engine can run here, and it says why (`faults.ts`). On the desktop the button
 *   still renders, so the operator learns the reason and the fix instead of meeting a dead control.
 *
 * ⚠ AVAILABILITY IS A REAL PROBE, never a presence check: a constructor or a bridge existing says
 * nothing about whether a click can work. `probe()` answers that; `start()` may still fault, and
 * the fault is reported the same way.
 */

import type { DictationFault } from "./faults";

export type DictationAvailability = { ok: true } | { ok: false; fault: DictationFault };

export interface DictationHandlers {
  /** Capture is live. The ONLY thing that may turn the button red. */
  onStart: () => void;
  /** The current phrase so far. Replaces the previous partial; never appended. */
  onPartial: (text: string) => void;
  /** A finished phrase, trimmed by the hook. Appended to the draft. */
  onFinal: (text: string) => void;
  /** A real fault. Always followed by `onEnd`. */
  onFault: (fault: DictationFault) => void;
  /** The session is over, for any reason. Called exactly once. */
  onEnd: () => void;
}

export interface DictationSession {
  /** Idempotent; safe before the engine has even started. */
  stop: () => void;
}

export interface DictationEngine {
  kind: "macos-native" | "web-speech" | "unavailable";
  /** May answer synchronously: the browser engine does, so a click starts it inside the same
   *  user gesture (some browsers refuse a capture that starts outside one). */
  probe: () => DictationAvailability | Promise<DictationAvailability>;
  start: (lang: string, handlers: DictationHandlers) => DictationSession;
}
