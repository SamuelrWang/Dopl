"use client";

/**
 * FlushGrid — sets the --grid-cell-x / --grid-cell-y CSS variables on <body>
 * so the fixed grid overlay (in globals.css :after of .mosaic-bg) divides the
 * viewport into an exact integer number of cells. Result: the grid lines are
 * perfectly flush at every edge of the screen, no partial cells.
 *
 * Targets ~160px per cell but rounds to whatever integer division gives the
 * closest fit, both horizontally and vertically.
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

      // Pick the integer number of cells that gets us closest to TARGET_CELL
      const colsX = Math.max(1, Math.round(vw / TARGET_CELL));
      const colsY = Math.max(1, Math.round(vh / TARGET_CELL));

      const cellX = vw / colsX;
      const cellY = vh / colsY;

      body.style.setProperty("--grid-cell-x", `${cellX}px`);
      body.style.setProperty("--grid-cell-y", `${cellY}px`);
    }

    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  return null;
}
