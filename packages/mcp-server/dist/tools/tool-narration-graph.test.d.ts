/**
 * THE SWEEP INTO THE REST OF THE MCP SURFACE — part 3 of 3: the workspace's
 * shared AUTHORED content. Siblings: `narration.test.ts` (the shared helper +
 * the workspace name) and `tool-narration.test.ts` (chats + members). Split
 * three ways at the §2 500-line cap.
 *
 * REACH, established rather than assumed: knowledge bases, skills, workflows,
 * clusters and the ontology graph are all WORKSPACE-scoped — any member creates
 * and renames them, and every member reads them. A base or a skill additionally
 * carries `visibility: "public"`, which publishes it workspace-wide. Nothing in
 * any of their schemas carries a charset rule except KB folder names and entry
 * titles (`NAME_RE`, features/knowledge/schema.ts): a base name, a skill name,
 * a cluster name, a workflow name, a step title, an ontology object name and
 * every label on it are bounded by LENGTH ALONE, so a newline is legal in all
 * of them and each was spliced into a `# ` or `### ` heading or a bullet head.
 *
 * `dopl_map` and `dopl_search` have no content of their own — they re-render
 * everything above — but `dopl_map` is the call the server instructions tell the
 * agent to make FIRST, before its first substantive reply, so a description that
 * could start a line started a line of the agent's opening picture of the
 * workspace.
 *
 * WHAT IS DELIBERATELY NOT NEUTRALIZED, and asserted as such below: entry
 * bodies, SKILL.md, workflow step instructions, ontology `text` attributes and
 * action prose. Those are the procedures the product exists to hand the agent;
 * clipping them to 160 characters would delete the feature. They are framed or
 * indented instead.
 *
 * The @dopl/client is hand-stubbed throughout; nothing transports.
 */
export {};
