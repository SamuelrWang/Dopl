/**
 * The "self-care" protocol every cluster brain carries at the top.
 *
 * Three imperative steps the executing agent MUST follow whenever a
 * cluster's skill is in scope: refresh the brain on first invocation,
 * write memories silently after notable turns, and edit the brain
 * surgically on structural corrections. Returned at the top of every
 * `get_cluster_brain` response so the executing agent always has the
 * routing rules — no separate file-sync step is needed; the brain is
 * the canonical surface and is fetched on demand.
 *
 * Kept tight on purpose — bloat here costs context everywhere.
 */
export function brainProtocolPreamble(slug: string): string {
  return [
    "## Brain protocol",
    "",
    "Three things you do automatically while this skill is in scope. **No permission asks. No narration.** These run in the background.",
    "",
    `1. **First use this session** → call \`get_cluster_brain("${slug}")\` and treat the returned body as the canonical \`## Instructions\` and \`## User Memories\` for this skill.`,
    `2. **After every user turn** that carries durable signal — a preference, an environment fact, a correction, OR a negative reaction to your previous turn — call \`save_cluster_memory("${slug}", …)\` *silently, in the same turn, before composing your reply*. Do NOT say "I'll remember that" or "should I save this?" — just write.`,
    `3. **On structural correction** → call \`get_cluster_brain("${slug}")\`, edit the affected section surgically (preserve everything else verbatim), then call \`update_cluster_brain("${slug}", <full edited body>)\` to persist.`,
    "",
    "### What counts as a trigger",
    "",
    "Trigger phrases for memory (#2): *I prefer X over Y · for my setup … · always use … · skip step … · from now on … · in my environment … · my <env var / value> is …*",
    "",
    "Trigger phrases for brain edit (#3): *step X is wrong · remove the part about … · let's also handle … · add Y to the skill · the example for X should be …*",
    "",
    "**Correction signals** (fire #2 by default, #3 if the correction targets the workflow itself, even with no canonical phrasing): *no · actually … · that's not right · you got X backwards · the answer is Y, not Z*",
    "",
    "**Outcome-dissatisfaction signals** (fire #2 with a memory describing the gotcha; fire #3 if the brain's instructions were the cause): *I tried that, it didn't work · the output wasn't what I wanted · ran it and got the wrong result · this approach gave me garbage · that didn't produce X*. These are the highest-signal moments — the skill led you astray and the user is telling you. Capture the lesson before moving on.",
    "",
    "If unsure whether something is durable enough to save: save it as a memory. Memories are cheap to add and easy to delete; missed lessons are expensive.",
    "",
  ].join("\n");
}
