"use client";

/**
 * WelcomeContent — first-run animated onboarding flow.
 *
 * Phases (linear):
 *   1. Intro messages (typewriter).
 *   2. MCP connect card — tabs for Claude Code / Codex / Openclaw, each
 *      showing a CLI command and an "agent prompt" for the user to paste
 *      into their agent. Blocks until /api/user/mcp-status pings back
 *      `connected: true`, at which point we POST /api/welcome/complete to
 *      stamp `profiles.onboarded_at` so the user never sees this again.
 *   3. Outro messages (typewriter).
 *   4. router.replace("/canvas?fromWelcome=1") — the canvas reads that flag
 *      and shows the final 3-step coach-card tour.
 *
 * Ports the typewriter primitives (CHAR_INTERVAL_MS / FADE_OUT_DURATION_MS
 * / per-entry pauseAfterMs / ref flags to gate async) from openclaw-cloud.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WelcomeMcpConnectStep } from "./welcome-mcp-step";

// ─────────────────────────────────────────────────────────
// Message sequence
// ─────────────────────────────────────────────────────────

type MsgEntry =
  | { kind: "text"; text: string; pauseAfterMs: number }
  | { kind: "mcp" };

const MESSAGES: MsgEntry[] = [
  { kind: "text", text: "Hey there! Welcome to Dopl.", pauseAfterMs: 1200 },
  {
    kind: "text",
    text: "Before I show you around, let's wire up your agent.",
    pauseAfterMs: 1200,
  },
  {
    kind: "text",
    text: "After connecting, your agent will gain access to Dopl's database of tools, and be able to wield your canvas.",
    pauseAfterMs: 1500,
  },
  { kind: "mcp" },
  {
    kind: "text",
    text: "You're connected! Your agent now has full Dopl access — how exciting.",
    pauseAfterMs: 1500,
  },
  {
    kind: "text",
    text: "Now, let's introduce you to your workspace.",
    pauseAfterMs: 1200,
  },
];

const CHAR_INTERVAL_MS = 30;
const FADE_OUT_DURATION_MS = 800;

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

interface WelcomeContentProps {
  userId: string;
}

export function WelcomeContent({ userId: _userId }: WelcomeContentProps) {
  const router = useRouter();

  const [msgIndex, setMsgIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [msgOpacity, setMsgOpacity] = useState(1);

  // Block-kind flags.
  const mcpConnectedRef = useRef(false);
  const [mcpConnected, setMcpConnected] = useState(false);

  // Guards against the final redirect firing more than once.
  const completionFiredRef = useRef(false);
  // Debounces /api/welcome/complete so a re-render or timer re-run can't
  // fire it twice.
  const completePostedRef = useRef(false);

  const current: MsgEntry | undefined = MESSAGES[msgIndex];

  // ── Fade current view out, bump index once faded. ────────────────
  const fadeAndAdvance = useCallback(() => {
    setMsgOpacity(0);
    const t = setTimeout(() => {
      setMsgOpacity(1);
      setMsgIndex((i) => i + 1);
    }, FADE_OUT_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  // ── Completion: redirect to /canvas after the final message fades. ─
  const triggerCompletion = useCallback(() => {
    if (completionFiredRef.current) return;
    completionFiredRef.current = true;
    router.prefetch("/canvas?fromWelcome=1");
    // Small post-last-message pause so the final line lingers.
    setTimeout(() => {
      router.replace("/canvas?fromWelcome=1");
    }, 400);
  }, [router]);

  // ── Sequencer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!current) {
      triggerCompletion();
      return;
    }

    if (current.kind === "text") {
      const { text, pauseAfterMs } = current;
      const isLast = msgIndex === MESSAGES.length - 1;

      let charIndex = 0;
      setDisplayedText("");
      setMsgOpacity(1);

      let pauseTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let fadeTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const intervalId = setInterval(() => {
        charIndex++;
        setDisplayedText(text.slice(0, charIndex));
        if (charIndex >= text.length) {
          clearInterval(intervalId);
          pauseTimeoutId = setTimeout(() => {
            if (isLast) {
              triggerCompletion();
            } else {
              setMsgOpacity(0);
              fadeTimeoutId = setTimeout(() => {
                setMsgIndex((i) => i + 1);
              }, FADE_OUT_DURATION_MS);
            }
          }, pauseAfterMs);
        }
      }, CHAR_INTERVAL_MS);

      return () => {
        clearInterval(intervalId);
        if (pauseTimeoutId) clearTimeout(pauseTimeoutId);
        if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
      };
    }

    if (current.kind === "mcp") {
      setDisplayedText("");
      setMsgOpacity(1);
      if (mcpConnectedRef.current) {
        return fadeAndAdvance();
      }
      return;
    }
  }, [current, msgIndex, fadeAndAdvance, triggerCompletion]);

  // ── MCP connected callback ───────────────────────────────────────
  const handleMcpConnected = useCallback(() => {
    if (mcpConnectedRef.current) return;
    mcpConnectedRef.current = true;
    setMcpConnected(true);

    // Flip profiles.onboarded_at so /welcome won't re-fire for this user.
    // Fire-and-forget — failure doesn't block the user from proceeding;
    // they'll just hit /welcome again next login, which is a minor annoyance
    // but not a breakage.
    if (!completePostedRef.current) {
      completePostedRef.current = true;
      fetch("/api/welcome/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch((err) =>
        console.error("[welcome] complete request error:", err)
      );
    }

    // Give the user a beat to read the "Connected!" state inside the card
    // before we fade the whole card out.
    setTimeout(() => {
      fadeAndAdvance();
    }, 1200);
  }, [fadeAndAdvance]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50"
      style={{ backgroundColor: "var(--bg-base, #0a0a0f)", overflow: "hidden" }}
    >
      {/* Background — same feel as /login so the transition is seamless. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/img/background_image.png')" }}
      />
      <div className="absolute inset-0 bg-black/50" />

      {/* Centered stage */}
      <div className="absolute inset-0 flex items-center justify-center px-6 z-10">
        <div
          className="w-full max-w-xl"
          style={{
            opacity: msgOpacity,
            transition: `opacity ${FADE_OUT_DURATION_MS}ms ease`,
          }}
        >
          {current?.kind === "text" && (
            <p
              style={{
                fontFamily:
                  "var(--font-geist-sans), -apple-system, sans-serif",
                fontSize: 17,
                color: "rgba(255,255,255,0.92)",
                lineHeight: 1.75,
                whiteSpace: "pre-wrap",
                margin: 0,
                textAlign: "center",
                animation: "loginFadeIn 0.4s ease-out both",
              }}
            >
              {displayedText}
            </p>
          )}

          {current?.kind === "mcp" && (
            <div
              className="mx-auto w-full max-w-lg p-5 rounded-2xl bg-[var(--card-surface-elevated)] border border-white/[0.12]"
              style={{ animation: "loginFadeIn 0.5s ease-out both" }}
            >
              <WelcomeMcpConnectStep onConnected={handleMcpConnected} />
              {mcpConnected && (
                <p className="mt-3 text-[11px] font-mono text-emerald-400 text-center">
                  Linked. Moving on…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
