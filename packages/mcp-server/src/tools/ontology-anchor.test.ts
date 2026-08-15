/**
 * `dopl_ontology(op="anchor")` — ⚠ the strongest identity claim in the product,
 * and the least checkable. The `instructions` block sends every agent here for
 * any "my/me" request, the heading is built from member-typed
 * `ontology_objects.name`, and `op="claim_anchor"` lets any agent on the
 * connection re-point the link it reads from. So the op is CONTEXT, says so,
 * and sits over an identity line checkable against the footer and `whoami`.
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
    // ⚠ …and it comes BEFORE the object's member-typed name.
    expect(text.indexOf("u-me")).toBeLessThan(text.indexOf("Anthony Davids"));
  });

  /**
   * ⚠ An object name can read exactly like a person's identity, so the result
   * must SAY OUT LOUD that the name is workspace data and the link is
   * agent-rewritable — never leave an agent to infer that a heading with a
   * person's name in it is who it is.
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
