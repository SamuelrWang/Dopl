/**
 * Developer portal URL state (W1.3). The properties that fail quietly:
 *  - 🔒 a project id the caller cannot see never survives parsing (it would reach a query);
 *  - 🔒 internal-off drops internal orgs' projects from the LOG scope, internal-on keeps them;
 *  - a free-text filter carrying PostgREST syntax (`,` `(` `)` spaces) reads as no filter;
 *  - a filter change resets paging and the open row, paging itself does not.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  canManageKeys,
  logProjectIds,
  parsePortalParams,
  portalQuery,
  withFilters,
  type PortalProject,
} from "./scope";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const EVT = "44444444-4444-4444-8444-444444444444";

const projects: PortalProject[] = [
  { id: P1, name: "Acme", apiVersion: "2026-10-27", org: { id: "o1", name: "Acme", internal: false }, role: "owner" },
  { id: P2, name: "Dopl App", apiVersion: "2026-10-27", org: { id: "o2", name: "Dopl", internal: true }, role: "developer" },
];

describe("parsePortalParams", () => {
  it("defaults to the first project, test env, 24h, internal included", () => {
    const p = parsePortalParams({}, projects);
    expect(p.project).toBe(P1);
    expect(p.env).toBe("test");
    expect(p.filters).toEqual(EMPTY_FILTERS);
  });

  it("refuses a project id the caller cannot see", () => {
    expect(parsePortalParams({ project: FOREIGN }, projects).project).toBe(P1);
    expect(parsePortalParams({ project: "not-a-uuid" }, projects).project).toBe(P1);
    expect(parsePortalParams({ project: P2 }, projects).project).toBe(P2);
    expect(parsePortalParams({ project: "all" }, projects).project).toBe("all");
  });

  it("reads `all` when the caller has no projects", () => {
    expect(parsePortalParams({ project: P1 }, []).project).toBe("all");
  });

  it("keeps closed-set values only", () => {
    const p = parsePortalParams({ env: "live", outcome: "error", kind: "glasses", window: "7d" }, projects);
    expect(p.env).toBe("live");
    expect(p.filters).toMatchObject({ outcome: "error", deviceKind: "glasses", window: "7d" });
    const bad = parsePortalParams({ env: "prod", outcome: "boom", kind: "toaster", window: "1y" }, projects);
    expect(bad.env).toBe("test");
    expect(bad.filters).toMatchObject({ outcome: null, deviceKind: null, window: "24h" });
  });

  it("drops a free-text filter carrying query syntax", () => {
    const p = parsePortalParams({ route: "auto", capability: "display.card", intent: "a,b)" }, projects);
    expect(p.filters).toMatchObject({ route: "auto", capability: "display.card", intent: null });
    expect(parsePortalParams({ route: "a b" }, projects).filters.route).toBeNull();
  });

  it("takes the first of a repeated param, a valid event id and an ISO cursor", () => {
    const p = parsePortalParams({ env: ["live", "test"], event: EVT, before: "2026-10-28T10:00:00Z" }, projects);
    expect(p.env).toBe("live");
    expect(p.filters.event).toBe(EVT);
    expect(p.filters.before).toBe("2026-10-28T10:00:00.000Z");
    expect(parsePortalParams({ event: "x", before: "soon" }, projects).filters).toMatchObject({ event: null, before: null });
  });

  it("reads internal=0 as hide", () => {
    expect(parsePortalParams({ internal: "0" }, projects).filters.internal).toBe(false);
    expect(parsePortalParams({ internal: "1" }, projects).filters.internal).toBe(true);
  });
});

describe("logProjectIds", () => {
  it("covers every visible project for `all`, and drops internal ones when hidden", () => {
    const all = parsePortalParams({ project: "all" }, projects);
    expect(logProjectIds(all, projects)).toEqual([P1, P2]);
    expect(logProjectIds(withFilters(all, { internal: false }), projects)).toEqual([P1]);
  });

  it("an internal project with internal hidden reads nothing", () => {
    const one = parsePortalParams({ project: P2, internal: "0" }, projects);
    expect(logProjectIds(one, projects)).toEqual([]);
  });
});

describe("portalQuery / withFilters", () => {
  it("round-trips through parse", () => {
    const p = withFilters(parsePortalParams({ project: P2, env: "live" }, projects), {
      outcome: "denied",
      route: "glasses",
      internal: false,
      window: "1h",
    });
    const back = parsePortalParams(Object.fromEntries(new URLSearchParams(portalQuery(p))), projects);
    expect(back).toEqual(p);
  });

  it("a filter change resets paging and the open row; paging keeps them", () => {
    const base = withFilters(parsePortalParams({}, projects), { before: "2026-10-28T10:00:00.000Z", event: EVT });
    expect(withFilters(base, { outcome: "ok" }).filters).toMatchObject({ before: null, event: null });
    expect(withFilters(base, { event: null }).filters.before).toBe("2026-10-28T10:00:00.000Z");
  });
});

describe("canManageKeys", () => {
  it("is owner or admin only", () => {
    expect(canManageKeys("owner")).toBe(true);
    expect(canManageKeys("admin")).toBe(true);
    expect(canManageKeys("developer")).toBe(false);
  });
});
