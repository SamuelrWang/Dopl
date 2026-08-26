/**
 * THE GUEST ROUTE-FLOOR PIN (guest-role M1, INVARIANTS §4A / §2B).
 *
 * A `guest` is the FLOOR role (rank 0, below `viewer`), and `withWorkspaceAuth`
 * defaults `minRole` to `"viewer"` — so EVERY workspace-scoped route rejects a
 * guest UNLESS it explicitly opts down to `minRole: "guest"`. The blast radius
 * is inverted: the danger is not that too much is closed, it is that a route
 * silently drifts to `guest` (over-open) or that one the guest web lane needs
 * silently loses its floor (a UX break with no error).
 *
 * This converts BOTH into a red test by READING THE ROUTE SOURCE (the same
 * technique as `workspaces/server/link-container-guard.test.ts` — a mock could
 * not tell a floor apart):
 *
 *   A. Every route in the guest-allowed set is at `minRole: "guest"`.
 *   B. NO route anywhere under `src/app/api` is at `minRole: "guest"` unless it
 *      is in that set.
 *
 * ⚠ The workspace floor is a TRIPWIRE, not the true gate. The real gate on each
 * of these is the channel-membership fence in the service layer
 * (`loadVisibleChannel` hides a private channel from a non-member;
 * `postMessage` / `createTaskFanOut` refuse `!membership`). This pin guards the
 * tripwire; the fence tests guard the gate. Do not weaken either.
 *
 * ⚠ Mutation-verify: reverting any single floor edit (drop the `{ minRole:
 * "guest" }` off an allowed GET, or raise an allowed POST back to `"member"`)
 * removes it from the discovered set → set A fails on that entry AND set B's
 * equality fails. Adding `guest` to any other route fails set B. 12 entries.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const API_ROOT = join(import.meta.dirname, "..");
const CHANNELS_REL = "channels";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The effective workspace `minRole` a `withWorkspaceAuth`-wrapped method runs
 * at: the explicit `minRole: "X"` in its options object, or `"viewer"` (the
 * wrapper default) when none is given. `null` = the method is not exported here,
 * or is not wrapped by `withWorkspaceAuth` (e.g. a `withUserAuth` route) — such
 * a method has no workspace floor to place at `guest`.
 */
function workspaceFloor(src: string, method: string): string | null {
  const re = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withWorkspaceAuth\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const from = m.index + m[0].length;
  const end = src.indexOf(");", from);
  const args = src.slice(from, end === -1 ? src.length : end);
  const mr = args.match(/minRole:\s*"(\w+)"/);
  return mr ? mr[1] : "viewer";
}

/** Every `route.ts` under `src/app/api`, as paths relative to that root. */
function allRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (relDir: string) => {
    for (const ent of readdirSync(join(API_ROOT, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name === "route.ts") out.push(rel);
    }
  };
  walk("");
  return out;
}

/** `"<relpath>#<METHOD>"` for every method placed at `minRole: "guest"`. */
function guestFlooredEverywhere(): Set<string> {
  const found = new Set<string>();
  for (const rel of allRouteFiles()) {
    const src = readFileSync(join(API_ROOT, rel), "utf8");
    for (const method of METHODS) {
      if (workspaceFloor(src, method) === "guest") found.add(`${rel}#${method}`);
    }
  }
  return found;
}

/**
 * THE GUEST-ALLOWED SET (INVARIANTS §4A / §2B + Samuel's Q1/Q2 rulings). Editing
 * this list is a deliberate act — a new channel surface a guest must reach is a
 * conscious addition here AND to §4A, and nowhere else can grant a guest a
 * floor without turning set B red.
 */
const GUEST_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  [`${CHANNELS_REL}/route.ts`, "GET"], // list channels
  [`${CHANNELS_REL}/[channelId]/route.ts`, "GET"], // read one channel
  [`${CHANNELS_REL}/[channelId]/messages/route.ts`, "GET"], // read transcript
  [`${CHANNELS_REL}/[channelId]/messages/route.ts`, "POST"], // post a message
  [`${CHANNELS_REL}/[channelId]/await/route.ts`, "GET"], // long-poll one channel
  [`${CHANNELS_REL}/await/route.ts`, "GET"], // long-poll workspace-wide
  [`${CHANNELS_REL}/[channelId]/tasks/route.ts`, "GET"], // list threads
  [`${CHANNELS_REL}/[channelId]/tasks/route.ts`, "POST"], // create a thread (Q1)
  [`${CHANNELS_REL}/[channelId]/tasks/[taskId]/route.ts`, "GET"], // read one thread
  [`${CHANNELS_REL}/[channelId]/members/route.ts`, "GET"], // see the roster
  [`${CHANNELS_REL}/presence/route.ts`, "POST"], // presence heartbeat (Q2)
  [`${CHANNELS_REL}/[channelId]/mentions/route.ts`, "POST"], // @-mention (Q2)
];

const ALLOWED_KEYS = new Set(GUEST_ALLOWED.map(([f, m]) => `${f}#${m}`));

describe("guest route floor — the guest-allowed set is exactly what runs at minRole:guest", () => {
  it("has 12 entries (pins the size against a silent add/drop)", () => {
    expect(ALLOWED_KEYS.size).toBe(12);
  });

  it.each(GUEST_ALLOWED)("A: %s %s is at minRole:guest", (file, method) => {
    const src = readFileSync(join(API_ROOT, file), "utf8");
    expect(workspaceFloor(src, method)).toBe("guest");
  });

  it("B: no route ANYWHERE under src/app/api is at minRole:guest outside the set", () => {
    const found = guestFlooredEverywhere();
    // Exact equality both directions: nothing extra is at guest, nothing in the
    // set lost its floor.
    expect([...found].sort()).toEqual([...ALLOWED_KEYS].sort());
  });

  it("guards a real gate, not just this list: the channel writes keep their membership fence", () => {
    // A floor lowered to guest is only safe because the SERVICE refuses a
    // non-member. If these fences ever move, the floor becomes the gate — so pin
    // that the refusal still lives where §2B says it does.
    const writes = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "features", "channels", "server", "service-writes.ts"),
      "utf8"
    );
    const fanout = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "features", "channels", "server", "service-tasks-fanout.ts"),
      "utf8"
    );
    expect(writes).toMatch(/loadVisibleChannel/);
    expect(writes).toMatch(/ChannelForbiddenError\("post to this channel"\)/);
    expect(fanout).toMatch(/loadVisibleChannel/);
    expect(fanout).toMatch(/ChannelForbiddenError\("create a task in this channel"\)/);
  });
});
