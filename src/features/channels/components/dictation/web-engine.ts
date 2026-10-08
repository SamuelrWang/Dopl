/**
 * THE BROWSER'S OWN ENGINE (`SpeechRecognition`, `webkit`-prefixed where it ships), behind the
 * shared interface. Moved here from `../use-dictation.ts` on 2026-10-08; the rules it kept:
 *
 * ⚠ THE AUDIO GOES TO THE BROWSER VENDOR'S SERVICE, by a path this app neither opens nor controls.
 * ⚠ FINAL RESULTS DRIVE THE DRAFT; interim results only feed the live preview (`onPartial`).
 * ⚠ `resultIndex` IS LOAD-BEARING: the result list is cumulative for the whole session.
 * ⚠ NOT IN `lib.dom.d.ts`, so the shapes are declared locally and minimally.
 */

import type { DictationEngine, DictationHandlers, DictationSession } from "./engine";
import { dictationFault } from "./faults";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult | undefined;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
}
export type RecognitionCtor = new () => SpeechRecognitionLike;

/** The constructor this browser ships, or null. Capability-keyed, never a user-agent test. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function webSpeechEngine(Ctor: RecognitionCtor, mac: boolean): DictationEngine {
  return {
    kind: "web-speech",
    /**
     * ⚠ THE BROWSER OFFERS NO PROBE: whether its service answers is only known by trying. What CAN
     * be known without trying is checked (offline is a certain failure); the rest surfaces as a
     * fault on the first attempt, with the same copy a probe would have used.
     */
    probe: () =>
      typeof navigator !== "undefined" && navigator.onLine === false
        ? { ok: false, fault: dictationFault("network", mac)! }
        : { ok: true },
    start: (lang: string, h: DictationHandlers): DictationSession => {
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        h.onEnd();
      };
      let engine: SpeechRecognitionLike;
      try {
        engine = new Ctor();
      } catch {
        h.onFault(dictationFault("network", mac)!);
        end();
        return { stop: () => {} };
      }
      engine.continuous = true;
      engine.interimResults = true;
      engine.lang = lang;
      engine.onstart = () => h.onStart();
      engine.onresult = (event) => {
        let final = "";
        let partial = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) final += text;
          else partial += text;
        }
        if (final.trim()) h.onFinal(final);
        h.onPartial(partial);
      };
      engine.onerror = (event) => {
        const fault = dictationFault(event?.error, mac);
        if (fault) h.onFault(fault);
        end();
        try {
          engine.stop();
        } catch {
          // already finished
        }
      };
      engine.onend = end;
      try {
        engine.start();
      } catch {
        h.onFault(dictationFault("network", mac)!);
        end();
        return { stop: () => {} };
      }
      return {
        stop: () => {
          // ⚠ GUARDED: `stop()` on an engine that already ended throws in some builds.
          try {
            engine.stop();
          } catch {
            // already finished
          }
          end();
        },
      };
    },
  };
}
