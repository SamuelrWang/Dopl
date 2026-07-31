"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ontology_ops_read_1 = require("./ontology-ops-read");
const identity_1 = require("./identity");
const narration_fixtures_1 = require("./narration-fixtures");
const CALLER = {
    userId: "u-me",
    runtime: identity_1.DESKTOP_SESSION_RUNTIME,
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
function client(anchor) {
    return (0, narration_fixtures_1.stub)({
        getOntologyAnchor: vitest_1.vi.fn(async () => anchor),
        getOntology: vitest_1.vi.fn(async () => SNAPSHOT),
    });
}
const textOf = async (c, caller) => (await (0, ontology_ops_read_1.opAnchor)(c, caller)).content.map((x) => x.text).join("\n");
(0, vitest_1.describe)("op=anchor states WHO you are before what you are linked to", () => {
    (0, vitest_1.it)("leads with the caller's immutable user id", async () => {
        const text = await textOf(client(OBJECT), CALLER);
        (0, vitest_1.expect)(text).toContain("You are user `u-me`.");
        // …and it comes before the object's member-typed name.
        (0, vitest_1.expect)(text.indexOf("u-me")).toBeLessThan(text.indexOf("Anthony Davids"));
    });
    /**
     * THE CORRECTION. The object name reads exactly like a person's identity —
     * this fixture is the shape of the real incident — so the result has to say
     * out loud that the name is workspace data and the link is agent-rewritable,
     * rather than leaving an agent to infer that a heading with a person's name
     * in it is who it is.
     */
    (0, vitest_1.it)("frames the object as CONTEXT, re-pointable by any agent, not as proof", async () => {
        const text = await textOf(client(OBJECT), CALLER);
        (0, vitest_1.expect)(text).toContain("member-typed data");
        (0, vitest_1.expect)(text).toContain(`re-point the link with op="claim_anchor"`);
        (0, vitest_1.expect)(text).toContain("never as proof of who you are");
    });
    (0, vitest_1.it)("routes the reader to the authoritative answer", async () => {
        const text = await textOf(client(OBJECT), CALLER);
        (0, vitest_1.expect)(text).toContain(`dopl_members(op="whoami")`);
    });
    (0, vitest_1.it)("says the id is unresolved rather than letting the object stand in for it", async () => {
        const text = await textOf(client(OBJECT), identity_1.UNKNOWN_CALLER);
        (0, vitest_1.expect)(text).toContain("could not resolve your user id");
        (0, vitest_1.expect)(text).not.toContain("You are user `");
    });
    (0, vitest_1.it)("states your id even when nothing is linked to you yet", async () => {
        const text = await textOf(client(null), CALLER);
        (0, vitest_1.expect)(text).toContain("You are user `u-me`.");
        (0, vitest_1.expect)(text).toContain(`op="claim_anchor"`);
    });
    /** PRIVACY: the anchor is workspace-graph data — no session detail belongs in it. */
    (0, vitest_1.it)("leaks no credential or hostname into the graph answer", async () => {
        const text = await textOf(client(OBJECT), CALLER);
        (0, vitest_1.expect)(text).not.toContain("mbp.local");
        (0, vitest_1.expect)(text).not.toContain("device token");
    });
});
