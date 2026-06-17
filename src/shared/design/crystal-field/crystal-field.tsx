"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_CRYSTAL_CONFIG, type CrystalFieldConfig } from "./config";
import { CrystalFieldEngine } from "./engine";

type CrystalFieldProps = {
  className?: string;
  /** Partial overrides merged over DEFAULT_CRYSTAL_CONFIG. Applied at mount. */
  config?: Partial<CrystalFieldConfig>;
  /** CSS selector for the panel the field frames; its bounding box is skipped
   *  during excitation (perf). Re-read on resize. */
  occludeSelector?: string;
};

/**
 * Full-viewport canvas background: a dark diamond-tile field that flips tiles
 * open — on cursor proximity and via a slow ambient ripple — to reveal hidden
 * iridescent crystal columns. Decorative; renders nothing for screen readers.
 */
export function CrystalField({ className, config, occludeSelector }: CrystalFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new CrystalFieldEngine(canvas, { ...DEFAULT_CRYSTAL_CONFIG, ...config });

    const syncOcclusion = () => {
      const el = occludeSelector ? document.querySelector(occludeSelector) : null;
      if (!el) return engine.setOcclusionRect(null);
      const r = el.getBoundingClientRect();
      engine.setOcclusionRect({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    };

    engine.start();
    syncOcclusion();
    // re-read once after layout settles (panel may size after first paint)
    const raf = requestAnimationFrame(syncOcclusion);
    window.addEventListener("resize", syncOcclusion);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncOcclusion);
      engine.destroy();
    };
    // Config is applied once at mount; the field is a set-and-forget background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }}
    />
  );
}
