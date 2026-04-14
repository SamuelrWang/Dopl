/**
 * Design system primitives.
 *
 * Two complementary layers:
 *  - Liquid glass primitives (GlassCard, GlassNavbar, StatusDot, MonoLabel)
 *    — the canonical aesthetic, ported from openclaw-cloud. Use these first.
 *  - Accent primitives (GlowText, Pill, PillBar, Surface, BackgroundGrid)
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
export { Surface, surfaceVariants, type SurfaceProps } from "./surface";

export { Pill, pillVariants, type PillProps } from "./pill";
export { PillBar } from "./pill-bar";
export { GlowText, glowTextVariants } from "./glow-text";
export { BackgroundGrid } from "./background-grid";
