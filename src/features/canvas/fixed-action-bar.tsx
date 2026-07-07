"use client";

/**
 * FixedActionBar — bottom-fixed pill bar with quick launchers for the
 * Knowledge and Skills browser panels. Uses the same dark-glass styling
 * as the canvas panels.
 */

import { getCanvasViewportSize } from "./viewport-size";
import { computeNewPanelPosition, useCanvas } from "./canvas-store";
import {
  KNOWLEDGE_PANEL_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  SKILLS_PANEL_SIZE,
} from "./types";

export function FixedActionBar() {
  const { state, dispatch } = useCanvas();

  /**
   * Spawn a knowledge panel — singleton, frame-existing-or-spawn pattern.
   */
  function handleSpawnKnowledge() {
    const { vw, vh } = getCanvasViewportSize();

    const existing = state.panels.find((p) => p.type === "knowledge");
    if (existing) {
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.min(vw / existing.width, vh / existing.height) * 0.9
        )
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: -(existing.x + existing.width / 2) * fitZoom + vw / 2,
          y: -(existing.y + existing.height / 2) * fitZoom + vh / 2,
          zoom: fitZoom,
        },
      });
      dispatch({ type: "SET_SELECTION", panelIds: [existing.id] });
      return;
    }

    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      KNOWLEDGE_PANEL_SIZE.width,
      KNOWLEDGE_PANEL_SIZE.height
    );
    const id = `knowledge-${state.nextPanelId}`;
    dispatch({ type: "CREATE_KNOWLEDGE_PANEL", id, x, y });
  }

  /**
   * Spawn a skills panel — singleton, frame-existing-or-spawn pattern.
   */
  function handleSpawnSkills() {
    const { vw, vh } = getCanvasViewportSize();

    const existing = state.panels.find((p) => p.type === "skills");
    if (existing) {
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.min(vw / existing.width, vh / existing.height) * 0.9
        )
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: -(existing.x + existing.width / 2) * fitZoom + vw / 2,
          y: -(existing.y + existing.height / 2) * fitZoom + vh / 2,
          zoom: fitZoom,
        },
      });
      dispatch({ type: "SET_SELECTION", panelIds: [existing.id] });
      return;
    }

    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      SKILLS_PANEL_SIZE.width,
      SKILLS_PANEL_SIZE.height
    );
    const id = `skills-${state.nextPanelId}`;
    dispatch({ type: "CREATE_SKILLS_PANEL", id, x, y });
  }

  return (
    <div
      className="fixed z-[32] flex justify-center px-4 pointer-events-none"
      style={{
        bottom: "calc(var(--app-panel-bottom) + 10px)",
        left: "var(--app-panel-left)",
        right: "var(--app-panel-right)",
      }}
    >
      <div className="pointer-events-auto">
        <div
          className="relative rounded-full overflow-hidden backdrop-blur-xl border border-border-default shadow-[var(--shadow-panel)]"
          style={{ backgroundColor: "var(--input-surface)" }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: "var(--shine-top-gradient)",
            }}
          />
          <div className="inline-flex items-center gap-2 px-3 py-2">
            {/* KNOWLEDGE pill — spawns a knowledge panel */}
            <button
              onClick={handleSpawnKnowledge}
              aria-label="Spawn knowledge panel"
              className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary bg-surface-raised-2 hover:bg-surface-raised-4 border border-border-default hover:border-border-highlight rounded-full transition-colors"
            >
              Knowledge
            </button>
            {/* SKILLS pill — spawns a skills panel */}
            <button
              onClick={handleSpawnSkills}
              aria-label="Spawn skills panel"
              className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary bg-surface-raised-2 hover:bg-surface-raised-4 border border-border-default hover:border-border-highlight rounded-full transition-colors"
            >
              Skills
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
