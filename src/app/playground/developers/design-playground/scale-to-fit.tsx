"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./design-playground.module.css";

const CANVAS_W = 2000;

/** Fits the 2000px-wide canvas to the available width with a transform. Never scales above 100%. */
export function ScaleToFit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, height: 0 });
  useLayoutEffect(() => {
    const a = outer.current;
    const b = inner.current;
    if (!a || !b) return;
    const measure = () => {
      const scale = Math.min(1, a.clientWidth / CANVAS_W);
      setFit({ scale, height: b.offsetHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(a);
    observer.observe(b);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outer} className={styles.fit} style={{ height: fit.height }}>
      <div ref={inner} className={styles.fitInner} style={{ transform: `scale(${fit.scale})`, width: CANVAS_W }}>
        {children}
      </div>
    </div>
  );
}
