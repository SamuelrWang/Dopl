"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms, applied via the --mk-delay custom property. */
  delay?: number;
}

/**
 * Fades + slides children in the first time they scroll into view.
 * Pairs with the .mk-reveal styles in marketing.css.
 */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("mk-reveal", visible && "mk-reveal-visible", className)}
      style={{ "--mk-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Mounts children invisible, then reveals once visible in the viewport —
 * used to gate CSS keyframe animations (pills, edges) until scrolled to.
 * Children receive `started` via the render-prop form.
 */
export function RevealGate({
  children,
  className,
}: {
  children: (started: boolean) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children(started)}
    </div>
  );
}
