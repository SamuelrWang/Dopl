"use client";

import { useEffect, useState } from "react";

/** Renders nothing until `kbTick >= at`, then mounts its child with a
 *  short fade + slight rise. Resetting `kbTick` to a value below `at`
 *  unmounts the child so the animation replays on next entry. */
export function Reveal({
  at,
  kbTick,
  children,
}: {
  at: number;
  kbTick: number;
  children: React.ReactNode;
}) {
  if (kbTick < at) return null;
  return <RevealOnMount key={at}>{children}</RevealOnMount>;
}

export function RevealOnMount({
  children,
  from = "down",
  delay = 0,
  rise = 6,
  duration,
}: {
  children: React.ReactNode;
  from?: "down" | "right";
  delay?: number;
  rise?: number;
  duration?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), Math.max(0, delay));
    return () => window.clearTimeout(id);
  }, [delay]);
  const initial =
    from === "right"
      ? "translateX(48px) scale(0.96)"
      : `translateY(${rise}px)`;
  const ms = duration ?? (from === "right" ? 420 : 280);
  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translate(0,0) scale(1)" : initial,
        transition:
          from === "right"
            ? `opacity ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
            : `opacity ${ms}ms ease-out, transform ${ms}ms ease-out`,
      }}
    >
      {children}
    </div>
  );
}

/** Char-by-char text reveal driven by the global tick. Renders a blinking
 *  caret while typing. `speed` is chars per tick (1 tick = 80ms). */
export function TypewriterText({
  text,
  startTick,
  currentTick,
  speed = 5,
}: {
  text: string;
  startTick: number;
  currentTick: number;
  speed?: number;
}) {
  const elapsed = Math.max(0, currentTick - startTick);
  const charsToShow = Math.min(text.length, elapsed * speed);
  const isTyping = charsToShow < text.length;
  return (
    <>
      {text.slice(0, charsToShow)}
      {isTyping && (
        <span className="inline-block w-[2px] h-[14px] bg-white/70 align-middle ml-0.5 animate-pulse" />
      )}
    </>
  );
}
