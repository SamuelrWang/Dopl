"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./design-playground.module.css";

const CANVAS_W = 2000;
const CANVAS_H = 1500;

/** Fits the 2000x1500 canvas to the available width with a transform. Never scales above 100%. */
export function ScaleToFit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / CANVAS_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={styles.fit} style={{ height: CANVAS_H * (scale ?? 0) }}>
      <div className={styles.fitInner} style={{ transform: `scale(${scale ?? 0})`, width: CANVAS_W, height: CANVAS_H }}>
        {children}
      </div>
    </div>
  );
}
