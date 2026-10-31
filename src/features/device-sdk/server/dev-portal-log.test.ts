/**
 * The portal's log fields (2026-10-31, docs/specs/dev-portal-live/PLAN.md Phase 1): the hot-path
 * fallback against a database lacking the columns (INVARIANTS §12), the router's verdicts, and the
 * small rules each row depends on.
 */
import { describe, expect, it, vi } from "vitest";
import type { DeviceEventRow } from "../types";
import { createColumnCompat, RECHECK_MS } from "./column-compat";
import { buildDevEvent, writeEventRows } from "./events";
import { operationOf } from "./with-developer-key";
import { parsePortalParams, type PortalProject } from "../portal/scope";
import { route, type RouteCandidate } from "../delivery/router";
import { actionTimes } from "./delivery-store";

const NEW = ["api_key_id", "action_id", "operation", "http_method", "route", "http_status"];
const row = (): DeviceEventRow =>
  buildDevEvent({ org_id: "o", project_id: "p", env: "live", outcome: "ok", operation: "deliver", http_status: 202, route: "/api/v1/x" });

/** A database with the old `dev_events`: any new column fails the whole insert, as PostgREST does. */
function oldDatabase() {
  const stored: DeviceEventRow[][] = [];
  const insert = vi.fn(async (rows: DeviceEventRow[]) => {
    const bad = NEW.find((c) => rows.some((r) => c in r));
    if (bad) return { error: { code: "PGRST204", message: `Could not find the '${bad}' column of 'dev_events' in the schema cache` } };
    stored.push(rows);
    return { error: null };
  });
  return { insert, stored };
}

describe("writeEventRows on a database without the new columns", () => {
  it("🔒 keeps the row, drops the fields, then costs no failed round trip inside the window", async () => {
    let t = 1_000;
    const compat = createColumnCompat(NEW, () => t);
    const db = oldDatabase();
    await writeEventRows(db.insert, [row()], compat);
    expect(db.stored).toHaveLength(1);
    expect(db.stored[0][0].outcome).toBe("ok");
    expect(db.insert).toHaveBeenCalledTimes(2);
    await writeEventRows(db.insert, [row()], compat);
    expect(db.insert).toHaveBeenCalledTimes(3);
    // After the window the full shape is tried again, so applying the migration heals without a deploy.
    t += RECHECK_MS + 1;
    await writeEventRows(db.insert, [row()], compat);
    expect(db.insert).toHaveBeenCalledTimes(5);
  });

  it("writes the full row when the columns exist; any other error still surfaces", async () => {
    const compat = createColumnCompat(NEW);
    const insert = vi.fn(async () => ({ error: null }));
    await writeEventRows(insert, [row()], compat);
    expect((insert.mock.calls[0] as unknown[][])[0]).toEqual([expect.objectContaining({ operation: "deliver", http_status: 202 })]);
    const fail = vi.fn(async () => ({ error: { code: "23505", message: "duplicate" } }));
    await expect(writeEventRows(fail, [row()], compat)).rejects.toThrow("duplicate");
    expect(fail).toHaveBeenCalledTimes(1);
  });
});

const device = (id: string, over: Partial<RouteCandidate["device"]> = {}): RouteCandidate["device"] => ({
  id,
  kind: "glasses",
  vendor: "v",
  model: "m",
  firmware: null,
  adapter_id: "even_g2",
  adapter_version: "1",
  capabilities: [{ capability: "present.display" } as RouteCandidate["device"]["capabilities"][number]],
  online: true,
  last_seen_at: "2026-10-31T00:00:00.000Z",
  ...over,
});
const profile = { id: "p", allowed_capabilities: ["present.display"] } as unknown as RouteCandidate["profile"];
const grant = { status: "active", scopes: ["present.display"], expires_at: null } as unknown as RouteCandidate["grant"];

describe("route(): considered", () => {
  it("records a verdict and a reason for every candidate", () => {
    const candidates: RouteCandidate[] = [
      { device: device("a"), grant, profile },
      { device: device("b", { online: false }), grant, profile },
      { device: device("c", { kind: "desktop" }), grant, profile },
    ];
    const r = route({ target: "a", capabilities: ["present.display"], urgency: "normal", candidates, lastSourceKind: null, now: Date.now() });
    const by = Object.fromEntries((r.decision.considered ?? []).map((c) => [c.device_id, c]));
    expect(by.b).toMatchObject({ verdict: "skipped" });
    expect(by.c).toMatchObject({ verdict: "skipped", reason: "not the requested target" });
    expect(by.a.verdict).toBe(r.ok ? "chosen" : "skipped");
  });

  it("names the filter on a refusal", () => {
    const candidates: RouteCandidate[] = [{ device: device("a", { online: false }), grant, profile }];
    const r = route({ target: "auto", capabilities: ["present.display"], urgency: "normal", candidates, lastSourceKind: null, now: Date.now() });
    expect(r.ok).toBe(false);
    expect(r.decision.considered).toEqual([{ device_id: "a", kind: "glasses", verdict: "skipped", reason: "offline" }]);
  });
});

describe("small rules", () => {
  it("operationOf names a call without parsing it twice", () => {
    expect(operationOf("/api/v1/users/u1/deliver")).toBe("deliver");
    expect(operationOf("/api/v1/devices/d1/actions/present.notify")).toBe("device.action");
    expect(operationOf("/api/v1/nope")).toBeNull();
  });

  it("actionTimes stamps only what a status earned", () => {
    expect(actionTimes("queued", "t")).toEqual({});
    expect(actionTimes("delivered", "t")).toEqual({ delivered_at: "t" });
    expect(actionTimes("done", "t")).toEqual({ delivered_at: "t", settled_at: "t" });
    expect(actionTimes("failed", "t")).toEqual({ settled_at: "t" });
  });

  it("an internal project opens on live, a customer's on test, and the URL still wins", () => {
    const p = (id: string, internal: boolean): PortalProject => ({ id, name: id, apiVersion: "1", org: { id: "o", name: "o", internal }, role: "owner" });
    const internal = "11111111-1111-4111-8111-111111111111";
    const customer = "22222222-2222-4222-8222-222222222222";
    const projects = [p(customer, false), p(internal, true)];
    expect(parsePortalParams({ project: internal }, projects).env).toBe("live");
    expect(parsePortalParams({ project: customer }, projects).env).toBe("test");
    expect(parsePortalParams({ project: internal, env: "test" }, projects).env).toBe("test");
  });
});
