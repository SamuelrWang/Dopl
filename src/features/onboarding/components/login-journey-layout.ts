/**
 * The login journey's map: its nodes, where they sit, and how each edge is
 * routed. Pure data + geometry; `./login-journey-showcase.tsx` draws it.
 *
 * THE NETWORK WRAPS THE TITLE (Samuel 2026-10-13): the U climbs both sides of
 * the card to its top, so the zones left and right of the two-line title are
 * filled (one or two nodes each, never mirrored), and everything else sits in
 * two rows under the title. Nodes in the title's band are placed in px off the
 * MEASURED title edges (`zone`), at least half a node clear of the text.
 */

export interface LoginJourneyImages {
  you?: string;
  teammate?: string;
  teammate2?: string;
  /** The Grok-paired person (a fourth face, so nobody repeats too often). */
  grokPerson?: string;
  dopl?: string;
  claude?: string;
  grok?: string;
  chatgpt?: string;
  hubspot?: string;
  slack?: string;
  sheets?: string;
  stripe?: string;
  figma?: string;
  laptop?: string;
  muse?: string;
}

/** person = a circle (photo, optionally agent-paired); app = a rounded square. */
export type Kind = "person" | "app";

/**
 * CIRCUIT-BOARD routing (Samuel's drawing): orthogonal runs with rounded
 * elbows, and only a short 45° jog for a side branch — every joint rounded.
 *   line   one straight vertical / horizontal run
 *   vh/hv  vertical then horizontal (or the reverse), one rounded elbow
 *   jog    a straight run, then 45° into the node (the run's axis is whichever
 *          leaves a true 45° for the rest)
 *   tap    a BRANCH OFF THE PARENT'S LINE, not off the parent: the parent's
 *          outgoing line runs HORIZONTALLY through `a`; the branch leaves it
 *          at the node's own x with a rounded turn, then runs straight up/down
 *          into the node's centre
 *   tapv   the same off a VERTICAL parent line: leaves at the node's own y,
 *          then runs straight across
 *   up45   up from `a`, right, then a rounded 45° bend DOWN into `b` — arriving
 *          on the node's upper-left (Samuel 2026-10-13, the top-right guy)
 */
export type Route = "line" | "vh" | "hv" | "jog" | "tap" | "tapv" | "up45";

export interface JNode {
  id: string;
  /** Centre as a fraction of the drawing box — unless `zone` places it. */
  u: number;
  v: number;
  /** In the title's band: hug the title's left/right edge instead of `u`. */
  zone?: "left" | "right";
  /** Reveal wave: the node pops at `popAt(wave)`, its line lands then. */
  wave: number;
  from?: string;
  route?: Route;
  kind: Kind;
  img?: keyof LoginJourneyImages;
  /** Paired agent's logo, inset bottom-right. */
  badge?: keyof LoginJourneyImages;
  /** Sit exactly one `up45` bend BELOW the mid row, so the incoming line's
   *  horizontal run lies ON the HubSpot → Stripe line's y (Samuel). */
  underMid?: boolean;
  /** Agent colour-bank slot for a paired person's two rings. */
  color?: number;
}

/** Row under the title, and the bottom row, as fractions of the box. */
const MID = 0.55;
const BOT = 1;

export const NODES: JNode[] = [
  // Left side, top → down. "you" and the Grok pair share the zone left of
  // the title (the pair a little lower); Sheets and Slack the zone right of it.
  { id: "you", u: 0, v: 0, wave: 0, kind: "person", img: "you" },
  { id: "dopl1", u: 0, v: MID - 0.03, wave: 1, from: "you", route: "line", kind: "app", img: "dopl" },
  { id: "grok", u: 0, v: 0.1, zone: "left", wave: 2, from: "dopl1", route: "hv", kind: "person", img: "grokPerson", badge: "grok", color: 12 },
  { id: "claude", u: 0.19, v: BOT, wave: 2, from: "dopl1", route: "vh", kind: "person", img: "you", badge: "claude", color: 2 },
  // ONE row under the title: HubSpot → Stripe off Claude, and Figma tapped
  // off the bottom line (Samuel 2026-10-13: same row, lines dead-centre).
  { id: "hubspot", u: 0.31, v: MID, wave: 3, from: "claude", route: "vh", kind: "app", img: "hubspot" },
  { id: "stripe", u: 0.46, v: MID, wave: 4, from: "hubspot", route: "line", kind: "app", img: "stripe" },
  // Along the bottom.
  { id: "mate", u: 0.42, v: BOT, wave: 3, from: "claude", route: "line", kind: "person", img: "teammate", badge: "chatgpt", color: 7 },
  { id: "dopl2", u: 0.71, v: BOT, wave: 4, from: "mate", route: "line", kind: "app", img: "dopl" },
  // Branches off the girl → Dopl line between the two, then straight up.
  { id: "figma", u: 0.6, v: MID, wave: 5, from: "mate", route: "tap", kind: "app", img: "figma" },
  { id: "laptop", u: 0.86, v: BOT, wave: 5, from: "dopl2", route: "line", kind: "app", img: "laptop" },
  // Up the right side: up, across ON the mid row's line, then 45° down onto
  // the guy — paired with Muse (blue, as on the Identities cards).
  { id: "mate2", u: 1, v: MID, underMid: true, wave: 5, from: "dopl2", route: "up45", kind: "person", img: "teammate2", badge: "muse", color: 10 },
  { id: "sheets", u: 1, v: 0, wave: 6, from: "mate2", route: "line", kind: "app", img: "sheets" },
  // Tapped off his line up to Sheets, then left: below Sheets, above him.
  { id: "slack", u: 0, v: 0.3, zone: "right", wave: 6, from: "mate2", route: "tapv", kind: "app", img: "slack" },
];

export const WAVES = 7;

export type Pt = { x: number; y: number };

/** A rounded joint: come in toward `p`, leave toward `next`, radius `k`. */
function joint(prev: Pt, p: Pt, next: Pt, k: number): string {
  const lin = Math.hypot(p.x - prev.x, p.y - prev.y);
  const lout = Math.hypot(next.x - p.x, next.y - p.y);
  const r = Math.min(k, lin / 2, lout / 2);
  if (r <= 0.5) return ` L${p.x},${p.y}`;
  const a = { x: p.x - ((p.x - prev.x) / lin) * r, y: p.y - ((p.y - prev.y) / lin) * r };
  const b = { x: p.x + ((next.x - p.x) / lout) * r, y: p.y + ((next.y - p.y) / lout) * r };
  return ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
}

/** The SVG path for one edge, centre to centre (nodes paint over the ends).
 *  `bend` is `up45`'s 45° leg (its horizontal and vertical extent). */
export function routePath(a: Pt, b: Pt, route: Route, r: number, bend = r * 2.5): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  if (route === "tap" || route === "tapv") {
    // The junction sits ON the parent's line; the branch starts a radius
    // back along that line (toward the parent), turns, and runs straight.
    const v = route === "tapv";
    const j = v ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    const k = Math.min(r, Math.hypot(b.x - j.x, b.y - j.y) / 2, Math.hypot(j.x - a.x, j.y - a.y));
    const start = v ? { x: j.x, y: j.y + Math.sign(a.y - b.y) * k } : { x: j.x - sx * k, y: j.y };
    const leave = v ? { x: j.x + sx * k, y: j.y } : { x: j.x, y: j.y + sy * k };
    return `M${start.x},${start.y} Q${j.x},${j.y} ${leave.x},${leave.y} L${b.x},${b.y}`;
  }
  if (route === "up45") {
    const top = { x: a.x, y: b.y - bend };
    const knee = { x: b.x - bend, y: b.y - bend };
    return `M${a.x},${a.y}${joint(a, top, knee, r)}${joint(top, knee, b, r * 0.8)} L${b.x},${b.y}`;
  }
  let corner: Pt | null = null;
  if (route === "vh") corner = { x: a.x, y: b.y };
  else if (route === "hv") corner = { x: b.x, y: a.y };
  else if (route === "jog") {
    // The straight run takes the excess; the jog covers the rest at 45°.
    corner =
      Math.abs(dx) >= Math.abs(dy)
        ? { x: a.x + sx * (Math.abs(dx) - Math.abs(dy)), y: a.y }
        : { x: a.x, y: a.y + sy * (Math.abs(dy) - Math.abs(dx)) };
  }
  if (!corner) return `M${a.x},${a.y} L${b.x},${b.y}`;
  // A 45° jog's joint is shallower, so it takes a smaller radius to look the same.
  const k = route === "jog" ? r * 0.8 : r;
  return `M${a.x},${a.y}${joint(a, corner, b, k)} L${b.x},${b.y}`;
}
