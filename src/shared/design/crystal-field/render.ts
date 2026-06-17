import type { CrystalFieldConfig } from "./config";
import type { Rgb } from "./color";
import type { TileField } from "./field";

/** Dynamic flip state the renderer reads, plus precomputed face colors. */
export type ActiveDrawState = {
  value: Float32Array;
  glow: Float32Array;
  frontRgb: Rgb;
  seamLitRgb: Rgb;
};

/**
 * Draw the active (flipping or lit) tiles over the resting blit. Each tile is a
 * perspective-projected quad: its 4 corners rotate in 3D about the flip axis,
 * then project through a camera so the near edge grows and the far edge shrinks
 * — a real foreshortened flip rather than a flat scale that reads as shrinking.
 */
export function drawActiveTiles(
  ctx: CanvasRenderingContext2D,
  field: TileField,
  draw: number[],
  cfg: CrystalFieldConfig,
  st: ActiveDrawState,
): void {
  const axisRad = (cfg.flipAxisDeg * Math.PI) / 180;
  const ca = Math.cos(axisRad);
  const sa = Math.sin(axisRad);
  const hs = field.s / Math.SQRT2; // half-side of the square equal to the diamond
  const camD = cfg.flipPerspective * hs;
  const lc: Array<[number, number]> = [
    [-hs, -hs],
    [hs, -hs],
    [hs, hs],
    [-hs, hs],
  ];
  const qx = [0, 0, 0, 0];
  const qy = [0, 0, 0, 0];
  const [fr0, fr1, fr2] = st.frontRgb;
  const [sl0, sl1, sl2] = st.seamLitRgb;

  for (const k of draw) {
    const v = st.value[k];
    const phi = v * Math.PI; // 0 = front, PI/2 = edge-on, PI = back
    const cosF = Math.cos(phi);
    const sinF = Math.sin(phi);
    const absx = Math.abs(cosF);
    const back = v >= 0.5;

    for (let c = 0; c < 4; c++) {
      const lx = lc[c][0];
      const ly = lc[c][1];
      const z = lx * sinF;
      const persp = camD / (camD - z);
      const x = lx * cosF * persp;
      const y = ly * persp;
      qx[c] = field.cx[k] + x * ca - y * sa;
      qy[c] = field.cy[k] + x * sa + y * ca;
    }

    const quad = () => {
      ctx.beginPath();
      ctx.moveTo(qx[0], qy[0]);
      ctx.lineTo(qx[1], qy[1]);
      ctx.lineTo(qx[2], qy[2]);
      ctx.lineTo(qx[3], qy[3]);
      ctx.closePath();
    };

    // brightness dips as the facet turns edge-on, peaks facing the viewer
    const turn = 0.34 + 0.66 * absx;

    if (back) {
      const g = st.glow[k];
      const lit = (cfg.litFloor + (1 - cfg.litFloor) * Math.min(1, g + 0.15)) * turn;
      ctx.fillStyle = `rgb(${(field.backR[k] * lit) | 0},${(field.backG[k] * lit) | 0},${(field.backB[k] * lit) | 0})`;
      quad();
      ctx.fill();
      if (absx > 0.4) {
        ctx.strokeStyle = `rgba(${sl0},${sl1},${sl2},${0.5 * absx})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      const shade = 0.55 + 0.45 * absx;
      ctx.fillStyle = `rgb(${(fr0 * shade) | 0},${(fr1 * shade) | 0},${(fr2 * shade) | 0})`;
      quad();
      ctx.fill();
    }

    // mid-flip glint — "glass catching light" as the facet passes edge-on. Uses
    // a brightened version of the tile's OWN color (not white), so a cyan facet
    // flashes cyan and a magenta one flashes magenta. Empty tiles don't glint.
    const glint = field.isPrism[k] ? (1 - Math.min(1, absx / 0.28)) * cfg.glintStrength : 0;
    if (glint > 0.01) {
      const gr = Math.min(255, field.backR[k] * 1.8 + 26);
      const gg = Math.min(255, field.backG[k] * 1.8 + 26);
      const gb = Math.min(255, field.backB[k] * 1.8 + 26);
      ctx.fillStyle = `rgba(${gr | 0},${gg | 0},${gb | 0},${glint})`;
      quad();
      ctx.fill();
    }
  }
}
