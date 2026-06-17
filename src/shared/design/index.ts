/**
 * Design system primitives.
 *
 * Two complementary layers:
 *  - Liquid glass primitives (GlassCard, GlassNavbar, StatusDot, MonoLabel)
 *    — the canonical aesthetic, ported from openclaw-cloud. Use these first.
 *  - Accent primitives (GlowText, Pill, PillBar, Surface)
 *    — complementary components for glow/hero elements.
 *
 * See `/design` for the full showcase and reference implementations.
 */

// ── Liquid glass primitives (canonical) ────────────────────────────
export { GlassCard, GlassDivider } from "./glass-card";
export { GlassNavbar, GlassNavLink } from "./glass-navbar";
export { StatusDot, type StatusDotState } from "./status-dot";
export { MonoLabel } from "./mono-label";
export { MarkdownMessage } from "./markdown-message";
export { FlushGrid } from "./flush-grid";

// ── Accent primitives (complementary) ──────────────────────────────
export { Surface, type SurfaceProps } from "./surface";

export { Pill, type PillProps } from "./pill";
export { PillBar } from "./pill-bar";
export { GlowText } from "./glow-text";

// ── Decorative backgrounds ─────────────────────────────────────────
export { CrystalField, CrystalShell, CRYSTAL_PANEL_ATTR, type CrystalFieldConfig } from "./crystal-field";
