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
export {};
