"use client";

/**
 * CanvasGridSync — when mounted, suppresses the body's `.mosaic-bg::after`
 * grid by adding a `canvas-active` class to <body>. The Canvas component
 * paints its own grid that pans with the camera, so the body grid would
 * just be a static double-image underneath.
 *
 * On unmount, the class is removed and the body grid reappears.
 */

import { useEffect } from "react";

export function CanvasGridSync() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("canvas-active");
    return () => {
      document.body.classList.remove("canvas-active");
    };
  }, []);

  return null;
}
