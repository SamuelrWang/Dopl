/**
 * The retired ontology wire names (`legacy-aliases.ts`) — additive, version-gated, and only for
 * desktops ≤ 1.36.0.
 */

import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  isLegacyOntologyClient,
  LegacyTolerantObjectCreateSchema,
  legacyOntologyRoute,
  withLegacySnapshotKeys,
} from "./legacy-aliases";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("isLegacyOntologyClient", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["garbage", false],
    ["1.36.0", true],
    ["1.35.9", true],
    ["0.9.0", true],
    ["1.36.1", false],
    ["1.37.0", false],
    ["2.0.0", false],
  ])("%s → %s", (v, want) => {
    expect(isLegacyOntologyClient(v)).toBe(want);
  });
});

describe("withLegacySnapshotKeys", () => {
  const body = { ontologies: [{ id: "o-1" }], objects: {}, personalOntologyIds: ["o-1"] };

  it("adds the old keys beside the new for a legacy desktop", () => {
    const out = withLegacySnapshotKeys(body, "1.36.0") as Record<string, unknown>;
    expect(out.ontologies).toBe(body.ontologies);
    expect(out.clusters).toBe(body.ontologies);
    expect(out.personalClusterIds).toBe(body.personalOntologyIds);
  });

  it("is the identity for a current client or a browser", () => {
    expect(withLegacySnapshotKeys(body, "1.37.0")).toBe(body);
    expect(withLegacySnapshotKeys(body, undefined)).toBe(body);
  });

  it("never invents a personal-shelf answer the payload did not carry", () => {
    const out = withLegacySnapshotKeys({ ontologies: [], objects: {} }, "1.30.0");
    expect("personalClusterIds" in out).toBe(false);
  });
});

describe("LegacyTolerantObjectCreateSchema", () => {
  it("re-keys the old parent field", () => {
    const parsed = LegacyTolerantObjectCreateSchema.parse({ clusterId: UUID, name: "Leads" });
    expect(parsed).toMatchObject({ ontologyId: UUID, name: "Leads" });
    expect("clusterId" in (parsed as object)).toBe(false);
  });

  it("leaves a current body alone", () => {
    expect(LegacyTolerantObjectCreateSchema.parse({ ontologyId: UUID, name: "Leads" })).toMatchObject({
      ontologyId: UUID,
    });
  });
});

describe("legacyOntologyRoute", () => {
  it("re-keys the segment param and adds the old single-row key", async () => {
    let seen: Record<string, string> | undefined;
    const route = legacyOntologyRoute(async (_req, ctx) => {
      seen = await ctx.params;
      return NextResponse.json({ ontology: { id: seen.ontologyId } });
    });
    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ clusterId: "o-9" }),
    });
    expect(seen).toEqual({ ontologyId: "o-9" });
    expect(await res.json()).toEqual({ ontology: { id: "o-9" }, cluster: { id: "o-9" } });
  });

  it("passes a non-JSON answer (a 204) through untouched", async () => {
    const route = legacyOntologyRoute(async () => new NextResponse(null, { status: 204 }));
    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ clusterId: "o-9" }),
    });
    expect(res.status).toBe(204);
  });
});
