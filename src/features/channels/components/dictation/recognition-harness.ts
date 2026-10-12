/**
 * Test harness (not collected: not a `*.test.ts` name) — **THE BROWSER'S `SpeechRecognition`,
 * FAKED**, for every suite that renders the composer's mic.
 *
 * ⚠ **THE MIC RENDERS ONLY WHERE THE BROWSER HAS AN ENGINE** (`use-dictation.ts`, the
 * feature-detection rule) and jsdom ships none, so without this every case about the mic
 * silently asserts on an absent button. A constructor is all `web-engine.ts › recognitionCtor`
 * probes for.
 *
 * ⚠ **IT IS A MODULE BECAUSE IT HAS TWO READERS** (2026-10-12, Review 21's split):
 * `composer-toolbar.test.tsx` needs the engine present so the glyph row includes the mic, and
 * `composer-dictation.test.tsx` drives its events. A second inline copy of a fake this stateful
 * is the two-readers-one-truth defect the tree records elsewhere — and the two copies would part
 * the day `onresult`'s shape changes.
 */

import { act } from "@testing-library/react";

/** The constructor `recognitionCtor` finds, plus the handles its events are fired through. */
export class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  /** The instance the engine most recently built — what the event helpers below address. */
  static last: FakeRecognition | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
}

/** Install the fake engine and forget any previous instance. Call from `beforeEach`. */
export function installWebRecognition(): void {
  FakeRecognition.last = null;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
}

/** Take it away again, so a suite that asserts the mic's ABSENCE still can. */
export function removeWebRecognition(): void {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
}

/**
 * One `onresult` from the browser engine. ⚠ **THE LIST IS CUMULATIVE AND `resultIndex` IS
 * LOAD-BEARING** (`web-engine.ts`), so this builds the real shape — `resultIndex` 0 over a
 * one-result list, which is what a session's current phrase looks like.
 *
 * ⚠ `act`, BECAUSE THE ENGINE'S EVENTS ARE NOT CLICKS. `fireEvent` wraps its own dispatch; a
 * callback invoked straight off this object is a state write from outside React's batching, and
 * the render it schedules never flushes before the next assertion.
 */
export function engineSays(text: string, isFinal: boolean): void {
  act(() => {
    FakeRecognition.last?.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal, 0: { transcript: text } } },
    });
  });
}

/** The engine's own `onerror`, by code (`dictation/faults.ts` maps it). */
export function engineError(code: string): void {
  act(() => {
    FakeRecognition.last?.onerror?.({ error: code });
  });
}

/** The engine ending the session — the `end` event, not a click on the mic. */
export function engineEnds(): void {
  act(() => {
    FakeRecognition.last?.onend?.();
  });
}
