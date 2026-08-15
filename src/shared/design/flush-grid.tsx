"use client";

/**
 * Sets --grid-cell-x / --grid-cell-y on <body>; consumed by globals.css
 * `.mosaic-bg::after`. Integer cell count per axis → grid flush at every
 * viewport edge, no partial cells. Targets ~160px, rounds to nearest fit.
 */

import { useEffect } from "react";

const TARGET_CELL = 160;

export function FlushGrid() {
  useEffect(() => {
    function recompute() {
      const body = document.body;
      if (!body) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const colsX = Math.max(1, Math.round(vw / TARGET_CELL));
      const colsY = Math.max(1, Math.round(vh / TARGET_CELL));

      const cellX = vw / colsX;
      const cellY = vh / colsY;

      body.style.setProperty("--grid-cell-x", `${cellX}px`);
      body.style.setProperty("--grid-cell-y", `${cellY}px`);
    }

    recompute();

    // Debounce: browser zoom fires many resize events; don't thrash the vars.
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(recompute, 100);
    };

    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return null;
}
