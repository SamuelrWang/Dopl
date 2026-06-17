import type { CrystalFieldConfig } from "./config";
import { hexToRgb, smoothstep, type Rgb } from "./color";
import { buildField, buildRestLayer, traceDiamond, type TileField } from "./field";
import { drawActiveTiles } from "./render";

export type OcclusionRect = { l: number; t: number; r: number; b: number };

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Runtime for the crystal tile field. Owns the per-tile flip state machine,
 * pointer/ripple excitation, and the perspective-projected draw loop. Pure
 * canvas + window APIs — instantiate from a client component inside an effect.
 */
export class CrystalFieldEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cfg: CrystalFieldConfig;
  private readonly reduced: boolean;

  private readonly rest: HTMLCanvasElement;
  private readonly frontRgb: Rgb;
  private readonly seamLitRgb: Rgb;

  private field: TileField | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;

  // dynamic per-tile flip state (sized to the current field)
  private value = new Float32Array(0);
  private target = new Float32Array(0);
  private vFrom = new Float32Array(0);
  private tStart = new Float32Array(0);
  private tDur = new Float32Array(0);
  private glow = new Float32Array(0);
  private holdUntil = new Float32Array(0);

  private px = -9999;
  private py = -9999;
  private pointerOn = false;
  private occ: OcclusionRect | null = null;

  private raf = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, cfg: CrystalFieldConfig) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CrystalFieldEngine: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.cfg = cfg;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.rest = document.createElement("canvas");
    this.frontRgb = hexToRgb(cfg.tileFront);
    this.seamLitRgb = hexToRgb(cfg.seamLit);
  }

  setOcclusionRect(rect: OcclusionRect | null): void {
    this.occ = rect;
  }

  start(): void {
    this.resize();
    window.addEventListener("resize", this.onResize);
    if (this.reduced) {
      this.drawStatic();
      return;
    }
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("blur", this.onLeave);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("blur", this.onLeave);
  }

  private onResize = () => this.resize();
  private onMove = (e: MouseEvent) => {
    this.px = e.clientX;
    this.py = e.clientY;
    this.pointerOn = true;
  };
  private onLeave = () => {
    this.pointerOn = false;
  };

  private resize(): void {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    // capped low: decorative blurry background doesn't need full retina res,
    // and fill-rate is the main per-frame cost.
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.field = buildField(this.w, this.h, this.cfg);
    this.allocDynamic(this.field.n);
    buildRestLayer(this.rest, this.field, this.cfg, this.dpr, this.w, this.h);
    if (this.reduced) this.drawStatic();
  }

  private allocDynamic(n: number): void {
    this.value = new Float32Array(n);
    this.target = new Float32Array(n);
    this.vFrom = new Float32Array(n);
    this.tStart = new Float32Array(n);
    this.tDur = new Float32Array(n).fill(this.cfg.flipDuration);
    this.glow = new Float32Array(n);
    this.holdUntil = new Float32Array(n);
  }

  private setTarget(k: number, tgt: number, dur: number, now: number): void {
    if (this.target[k] === tgt) return;
    this.vFrom[k] = this.value[k];
    this.target[k] = tgt;
    this.tStart[k] = now;
    this.tDur[k] = dur;
  }

  private frame = (now: number) => {
    const f = this.field;
    if (!f) return;
    const cfg = this.cfg;
    const dt = Math.min(64, now - this.last);
    this.last = now;

    // organic ambient: a drifting, domain-warped noise field — morphing patches
    // of reveal rather than a marching wavefront.
    const at = now * cfg.ambientSpeed * 0.001;
    const freq = 1 / cfg.ambientScale;
    const r2 = cfg.revealRadius * cfg.revealRadius;
    const glowDecay = dt / (cfg.driftBackDuration * cfg.afterglowFactor);

    this.ctx.drawImage(this.rest, 0, 0, this.w, this.h);

    const draw: number[] = [];
    for (let k = 0; k < f.n; k++) {
      let excite = 0;
      const occ = this.occ;
      const hidden =
        occ != null && f.cx[k] > occ.l && f.cx[k] < occ.r && f.cy[k] > occ.t && f.cy[k] < occ.b;

      if (!hidden) {
        if (this.pointerOn) {
          const dx = f.cx[k] - this.px;
          const dy = f.cy[k] - this.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            excite = Math.pow(1 - Math.sqrt(d2) / cfg.revealRadius, cfg.cursorFalloff);
          }
        }
        if (cfg.ambientEnabled) {
          const fx = f.cx[k] * freq;
          const fy = f.cy[k] * freq;
          const wx = fx + cfg.ambientWarp * Math.sin(fy * 1.7 + at * 0.6);
          const wy = fy + cfg.ambientWarp * Math.cos(fx * 1.5 - at * 0.5);
          const nz =
            Math.sin(wx + at) * 0.6 +
            Math.sin((wx + wy) * 0.85 - at * 0.7) * 0.5 +
            Math.sin(wy * 1.3 + at * 1.1) * 0.4 +
            Math.sin((wx - wy) * 0.6 + at * 0.3) * 0.3;
          const n01 = 0.5 + nz * 0.28 + f.jit[k] * cfg.ambientJitter;
          const e =
            smoothstep(cfg.ambientThreshold, cfg.ambientThreshold + cfg.ambientSoftness, n01) *
            cfg.ambientPeak;
          if (e > excite) excite = e;
        }
      }

      if (excite > 0.04) {
        this.holdUntil[k] = now + cfg.lingerDuration * (0.4 + 0.6 * excite);
        this.setTarget(k, 1, cfg.flipDuration, now);
        if (excite > this.glow[k]) this.glow[k] = excite;
      } else if (now > this.holdUntil[k]) {
        this.setTarget(k, 0, cfg.driftBackDuration, now);
      }

      if (this.value[k] !== this.target[k] || this.tStart[k] === now) {
        const p = Math.min(1, (now - this.tStart[k]) / this.tDur[k]);
        const e = this.target[k] === 1 ? easeInOut(p) : easeOut(p);
        this.value[k] = this.vFrom[k] + (this.target[k] - this.vFrom[k]) * e;
      }
      if (this.glow[k] > 0) this.glow[k] = Math.max(0, this.glow[k] - glowDecay);

      if (this.value[k] > 0.002 || excite > 0.002) draw.push(k);
    }

    drawActiveTiles(this.ctx, f, draw, cfg, {
      value: this.value,
      glow: this.glow,
      frontRgb: this.frontRgb,
      seamLitRgb: this.seamLitRgb,
    });
    this.raf = requestAnimationFrame(this.frame);
  };

  // reduced-motion: calm static state, prisms only faintly hinted
  private drawStatic(): void {
    const f = this.field;
    if (!f) return;
    const ctx = this.ctx;
    ctx.drawImage(this.rest, 0, 0, this.w, this.h);
    ctx.globalAlpha = 0.16;
    for (let k = 0; k < f.n; k++) {
      if (!f.isPrism[k]) continue;
      ctx.fillStyle = `rgb(${f.backR[k]},${f.backG[k]},${f.backB[k]})`;
      traceDiamond(ctx, f.cx[k], f.cy[k], f.s, f.s);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
