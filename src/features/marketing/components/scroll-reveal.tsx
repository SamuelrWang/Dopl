"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Fade-up on scroll-in for the sections that are NOT pinned scenes — Ontology
 * (`.lp-ont`), Control (`.lp-ctl`), Developers (`.lp-connect`) — and fade-OUT when
 * the visitor scrolls back UP past them, matching how the Multiplayer scrub
 * reverses its own text.
 *
 * Direction matters and is deliberately asymmetric: scrolling DOWN past a
 * section leaves it shown — only re-crossing the reveal line upward re-arms it.
 * The observer callback tells the two apart by which side the section left on
 * (`boundingClientRect.top`).
 *
 * What each section animates is declared in marketing.css under "Scroll
 * reveal"; this component only owns WHEN. Those rules are TRANSITIONS, not
 * keyframes, on purpose — a `both`-fill animation pins opacity after it ends,
 * which would swallow the fade-out this exists to provide.
 *
 * ⚠ A COMPONENT, not a hook, because `control-section.tsx` is a server
 * component and must stay one. Rendering the `<section>` here keeps the client
 * boundary at that single element — the whole subtree still arrives as
 * server-rendered `children`.
 *
 * ⚠ `armed` is set HERE, after mount, never in the markup. No JS, no
 * IntersectionObserver, or reduced-motion means no attribute at all, and the
 * CSS leaves the section at its normal end state rather than blank. A section
 * hidden by a stylesheet that then waits on script is a section that can stay
 * invisible forever.
 */

/**
 * Fires with the section's top this far down the viewport. Half, matching
 * `use-multiplayer-scrub`'s REVEAL_LINE and for the same reason recorded there:
 * at a third the fade finished while the text was still near the fold, so by
 * the time it was worth reading it had already played.
 */
const REVEAL_LINE = 0.5;

export function ScrollReveal({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Honour the OS setting by never arming — the section simply renders.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.reveal = "armed";

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          el.dataset.reveal = "in";
          return;
        }
        // Which way did it leave? A positive top means the section sits BELOW
        // the reveal line — the visitor scrolled back up — so re-arm. A
        // negative top means it scrolled off the TOP (visitor going down past
        // it): leave it shown, exactly as the Multiplayer scrub leaves its end
        // state standing.
        if (entry.boundingClientRect.top > 0) el.dataset.reveal = "armed";
      },
      // ⚠ A ratio `threshold` cannot express this: these sections can run
      // taller than the viewport, so a given percentage of one is never on
      // screen at once and the observer would never fire. A bottom margin is
      // viewport-relative instead.
      { rootMargin: `0px 0px -${REVEAL_LINE * 100}% 0px` },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      delete el.dataset.reveal;
    };
  }, []);

  return (
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}
