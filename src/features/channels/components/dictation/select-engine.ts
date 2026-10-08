/**
 * WHICH ENGINE THIS SURFACE GETS (2026-10-08). Pure over its inputs so the rule is testable
 * without a browser:
 *
 * 1. INSIDE THE DESKTOP APP the browser engine is NEVER chosen: Electron's Chromium ships no
 *    Google speech key, so `webkitSpeechRecognition` exists there and can never work. That
 *    presence-only check is the bug this file replaced ("Dictation unavailable" on every click).
 *    - a main that exposes `dictation` → the on-device engine;
 *    - an older main without it → `unavailable` ("Update Dopl for dictation", Fn hint on a Mac).
 *    The button always renders on the desktop: an honest reason beats a missing control there.
 * 2. IN A BROWSER: its own engine where it ships one; otherwise null, and no button at all (a
 *    Firefox user has nothing to fix, so there is nothing to say).
 */

import type { DoplDictationBridge } from "@/shared/lib/desktop";
import type { DictationEngine } from "./engine";
import { dictationFault } from "./faults";
import { nativeEngine } from "./native-engine";
import { webSpeechEngine, type RecognitionCtor } from "./web-engine";

export interface EngineEnv {
  isDesktop: boolean;
  bridge: DoplDictationBridge | null;
  webCtor: RecognitionCtor | null;
  mac: boolean;
}

export function unavailableEngine(code: string, mac: boolean): DictationEngine {
  const fault = dictationFault(code, mac)!;
  return {
    kind: "unavailable",
    probe: () => ({ ok: false, fault }),
    start: (_lang, h) => {
      h.onFault(fault);
      h.onEnd();
      return { stop: () => {} };
    },
  };
}

export function selectEngine(env: EngineEnv): DictationEngine | null {
  if (env.isDesktop) {
    return env.bridge ? nativeEngine(env.bridge, env.mac) : unavailableEngine("desktop-outdated", env.mac);
  }
  return env.webCtor ? webSpeechEngine(env.webCtor, env.mac) : null;
}
