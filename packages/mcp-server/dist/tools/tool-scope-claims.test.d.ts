/**
 * THE COMPLETENESS GUARD — no tool may promise more than its handler returns.
 *
 * WHY THIS SUITE EXISTS, in one incident. `dopl_map`'s description opened
 * "Compact manifest of the active workspace — EVERY knowledge base, skill,
 * workflow cluster, and ontology cluster". It returns none of those four in
 * full: skills are filtered to `status === "active"` in `map.ts` itself, and
 * `listSkills` / `listWorkflows` / `listKbBases` are each visibility-filtered
 * server-side before the rows arrive. Two agents on two machines called it,
 * got "10 knowledge bases, 6 skills" against "4 KBs, 1 skill", and did
 * everything right from there: they formed a permissions hypothesis, tested it
 * with `access_matrix`, disproved it, tested workspace targeting, disproved
 * that, and escalated a confirmed server-side `dopl_map` bug to the operator.
 *
 * There was no bug. One caller was the owner; five of the six skills were
 * owner-private. Three questions, three correct answers — and one word, "every",
 * that told both agents the answers were comparable. They believed the tool.
 * That is the correct behaviour for an agent and it is the tool's job not to
 * abuse it.
 *
 * TWO GUARDS, both mechanical:
 *
 *   1. THE HEADLINE RULE. A tool's first sentence is the one line every model
 *      reads before deciding whether to call it, and it is where `dopl_map` and
 *      `dopl_search` both put their overclaim. No headline may contain a
 *      completeness word. There is no allowlist: a headline never needs one,
 *      because a claim that needs qualifying does not belong in the sentence
 *      that has no room to qualify it.
 *
 *   2. THE FILTERED-OP LEDGER. For each read op whose handler demonstrably
 *      applies a filter — proved here by scanning the tool's own source for the
 *      filter expression, so the ledger cannot quietly describe code that no
 *      longer exists — the op's bullet must disclose the scope. Bidirectional
 *      on purpose: removing a filter without updating the prose fails just as
 *      loudly as adding one, because a description that under-claims sends
 *      agents to a second tool they did not need.
 *
 * LIKE `channel-law.test.ts`, THIS PINS PROSE, NOT BEHAVIOUR. Every assertion
 * is a string match on a registered description. Whether a disclosure is TRUE
 * is checked against the code that owns each filter — `canSeeSkill` in
 * `src/features/skills/server/service-shared.ts`, `listWorkflows` in
 * `src/features/workflows/server/service.ts` — and this suite is worthless
 * against a change on that side. What it is worth is that the class cannot
 * return silently: the next "every" is a red test, not a false escalation.
 */
export {};
