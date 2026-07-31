/**
 * `dopl_ontology(op="anchor")` — the strongest identity claim in the product,
 * and previously the least checkable one.
 *
 * The MCP `instructions` block tells every agent to call this for any "my/me"
 * request. It answered `You are anchored to this object.` above a heading built
 * from `ontology_objects.name` — member-typed text — with no caller id, no
 * framing header, and no test. An agent that read a name out of it and reported
 * that name as its own identity was doing exactly what the surface invited, and
 * `op="claim_anchor"` means any agent on the connection can re-point the link
 * it reads from.
 *
 * The op is CONTEXT now, and says so, over an identity line the reader can
 * check against the footer and against `whoami`.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opAnchor } from "./ontology-ops-read";
import { UNKNOWN_CALLER, DESKTOP_SESSION_RUNTIME, type CallerIdentity } from "./identity";
import { stub } from "./narration-fixtures";

const CALLER: CallerIdentity = {
  userId: "u-me",
  runtime: DESKTOP_SESSION_RUNTIME,
  credentialKind: "device",
  credentialLabel: "Dopl Desktop CLI (mbp.local)",
};

const OBJECT = {
  id: "obj-1",
  name: "Anthony Davids",
  subtitle: "",
  attributes: [],
  methods: [],
  relationships: [],
  childIds: [],
  template: [],
  updatedAt: "2026-07-31T00:00:00Z",
};

const SNAPSHOT = { clusters: [], objects: { "obj-1": OBJECT } };

function client(anchor: unknown): DoplClient {
  return stub({
    getOntologyAnchor: vi.fn(async () => anchor),
    getOntology: vi.fn(async () => SNAPSHOT),
  });
}

const textOf = async (c: DoplClient, caller?: CallerIdentity) =>
  (await opAnchor(c, caller)).content.map((x) => x.text).join("\n");

describe("op=anchor states WHO you are before what you are linked to", () => {
  it("leads with the caller's immutable user id", async () => {
    const text = await textOf(client(OBJECT), CALLER);
    expect(text).toContain("You are user `u-me`.");
    // …and it comes before the object's member-typed name.
    expect(text.indexOf("u-me")).toBeLessThan(text.indexOf("Anthony Davids"));
  });

  /**
   * THE CORRECTION. The object name reads exactly like a person's identity —
   * this fixture is the shape of the real incident — so the result has to say
   * out loud that the name is workspace data and the link is agent-rewritable,
   * rather than leaving an agent to infer that a heading with a person's name
   * in it is who it is.
   */
  it("frames the object as CONTEXT, re-pointable by any agent, not as proof", async () => {
    const text = await textOf(client(OBJECT), CALLER);
    expect(text).toContain("member-typed data");
    expect(text).toContain(`re-point the link with op="claim_anchor"`);
    expect(text).toContain("never as proof of who you are");
  });

  it("routes the reader to the authoritative answer", async () => {
    const text = await textOf(client(OBJECT), CALLER);
    expect(text).toContain(`dopl_members(op="whoami")`);
  });

  it("says the id is unresolved rather than letting the object stand in for it", async () => {
    const text = await textOf(client(OBJECT), UNKNOWN_CALLER);
    expect(text).toContain("could not resolve your user id");
    expect(text).not.toContain("You are user `");
  });

  it("states your id even when nothing is linked to you yet", async () => {
    const text = await textOf(client(null), CALLER);
    expect(text).toContain("You are user `u-me`.");
    expect(text).toContain(`op="claim_anchor"`);
  });

  /** PRIVACY: the anchor is workspace-graph data — no session detail belongs in it. */
  it("leaks no credential or hostname into the graph answer", async () => {
    const text = await textOf(client(OBJECT), CALLER);
    expect(text).not.toContain("mbp.local");
    expect(text).not.toContain("device token");
  });
});
