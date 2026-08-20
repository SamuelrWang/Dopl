/** Scrub math shared by the landing page's scroll engines
 *  (use-banner-scrub, use-multiplayer-scrub, use-glass-scrub, banner-hum). */

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** smoothstep — eases both ends, so a scrubbed motion never starts or stops
 *  abruptly. */
export const ease = (t: number) => t * t * (3 - 2 * t);

/** easeOutQuad — decelerating, never past 1. Quad, not cubic: cubic spends the
 *  back half of the range creeping through the last few percent. */
export const easeOut = (t: number) => 1 - (1 - t) ** 2;

/** 0→1 as `v` travels from `from` to `to`; works in either direction (`from`
 *  may be greater than `to`), clamped outside. */
export const ramp = (v: number, from: number, to: number) => clamp01((v - from) / (to - from));
