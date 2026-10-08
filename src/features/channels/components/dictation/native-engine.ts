/**
 * THE DESKTOP'S ON-DEVICE ENGINE, behind the shared interface (2026-10-08). Thin: main owns the
 * helper process (`dopl-desktop-app/main/dictation.js`); this side turns its codes into the
 * operator's words (`faults.ts`) and its events into the hook's handlers.
 *
 * ⚠ EVENTS ARE FILTERED BY SESSION ID. Every composer window hears `dictation:event`, and a
 * second composer must never type another one's transcript.
 */

import type { DoplDictationBridge } from "@/shared/lib/desktop";
import type { DictationEngine, DictationHandlers, DictationSession } from "./engine";
import { dictationFault } from "./faults";

export function nativeEngine(bridge: DoplDictationBridge, mac: boolean): DictationEngine {
  const fault = (code: string | null | undefined) =>
    dictationFault(code || "helper-failed", mac) ?? dictationFault("helper-failed", mac)!;

  return {
    kind: "macos-native",
    probe: async () => {
      let answer;
      try {
        answer = await bridge.probe(lang());
      } catch {
        answer = null;
      }
      if (answer && answer.state === "ready") return { ok: true };
      return { ok: false, fault: fault(answer && "code" in answer ? answer.code : null) };
    },
    start: (language: string, h: DictationHandlers): DictationSession => {
      let id: string | null = null;
      let ended = false;
      let stopAsked = false;
      const end = () => {
        if (ended) return;
        ended = true;
        unsubscribe();
        h.onEnd();
      };
      const unsubscribe = bridge.onEvent((event) => {
        if (ended || id === null || event.id !== id) return;
        if (event.type === "start") h.onStart();
        else if (event.type === "partial") h.onPartial(event.text);
        else if (event.type === "final") h.onFinal(event.text);
        else if (event.type === "error") {
          const f = dictationFault(event.code, mac);
          if (f) h.onFault(f);
        } else if (event.type === "end") end();
      });
      void bridge
        .start(language)
        .then((res) => {
          if (ended) return;
          if (!res || !res.ok) {
            h.onFault(fault(res && !res.ok ? res.code : null));
            end();
            return;
          }
          id = res.id;
          // Stopped while the helper was still starting: honour it now.
          if (stopAsked) void bridge.stop(res.id);
        })
        .catch(() => {
          h.onFault(fault(null));
          end();
        });
      return {
        stop: () => {
          if (ended) return;
          stopAsked = true;
          // The helper flushes its final phrase, then main pushes `end`; the hook keeps listening
          // until then so the last words land.
          if (id !== null) void bridge.stop(id);
        },
      };
    },
  };
}

function lang(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "";
}
