/**
 * workspace-arg.ts — 🔒 **WHERE `workspace=` STILL MEANS ANYTHING, AND WHAT IS
 * SAID WHEN IT DOES NOT.** The registrar is the mechanism; this file is the
 * policy, so the one question B2 and B13 answer — *can the server find this
 * op\'s container without being told?* — is settled in one place and pinned by
 * one suite (`workspace-arg.test.ts`).
 */

import { inlineOr } from "./tools/narration.js";

/**
 * THE PER-CALL `workspace` ARG'S DESCRIPTION — ONE SHORT CONTRACT, PUSHED ONCE
 * PER DOMAIN TOOL (C9, 2026-09-02; the retirement clause is B13).
 *
 * ⚠ EVERY CHARACTER HERE IS PAID FOR NINE TIMES, ON EVERY CONNECTION.
 * `registerTool` injects this arg into all 9 domain schemas, so the 717-char
 * paragraph this replaced spent ~10,000 served chars stating one rule fourteen
 * times — thirteen of them pure repetition, and the same rule the instructions
 * already owe the agent before its first tool call.
 *
 * ⚠ THE FULL RULE IS STATED ONCE, IN `instructions.ts`. ⚠ DO NOT RESTATE ANY OF
 * IT HERE. A rule an agent needs before it calls anything belongs in the
 * instructions, which are pushed once.
 *
 * ⚠ **THE SECOND CLAUSE IS THE RETIREMENT, AND IT IS DELIBERATELY ONE CLAUSE**
 * (B13). The arg is honoured on the ops in {@link WORKSPACE_ARG_OPS} and
 * IGNORED — never refused — everywhere else, for one release, so a caller that
 * still sends it gets its answer instead of an error. The ignore is REPORTED on
 * the `_dopl_status` footer rather than swallowed, which is what makes one
 * release enough to notice.
 *
 * Pinned by `server.test.ts` — the length, and that every domain tool carries
 * this exact string rather than a per-tool copy.
 */
export const WORKSPACE_ARG_DESCRIPTION =
  "Workspace or home-channel container for list/create; omit for this one. Ignored elsewhere.";

/**
 * 🔒 **THE `container=` ARGUMENT'S DESCRIPTION — R-32's ADDRESS GRAMMAR IN ONE
 * LINE** (Samuel, 2026-09-17).
 *
 * ⚠ IT REPLACES {@link WORKSPACE_ARG_DESCRIPTION} ON THE SAME NINE SCHEMAS AND
 * IS PAID FOR NINE TIMES, so the same rule applies: the FULL contract is stated
 * once, in `instructions.ts`, and is not restated here.
 *
 * ⚠ **THE DEFAULT IS NAMED, AND THAT IS THE BUDGET-NEUTRAL HALF OF THE
 * RULING.** "home is structural, never a prompt line" means the resolver
 * decides it; what the agent still cannot derive from anywhere else is WHICH
 * container an omitted argument lands in, and three words say it.
 */
export const CONTAINER_ARG_DESCRIPTION =
  "Container for list/create: slug, id, or `home` (your default). Ignored elsewhere.";

/**
 * 🔒 **THE DEPRECATED ALIAS CARRIES NO DESCRIPTION AT ALL, AND THAT IS A
 * DECISION** (R-32, 2026-09-17).
 *
 * `workspace=` maps to the same resolver for ONE release, and the schema must
 * keep PUBLISHING the key because `strictInput` turns an unknown one into
 * `-32602` — the one outcome a deprecation window rules out. What it must not
 * do is DESCRIBE it: a description is pushed to every client on every
 * connection, including every client that never sends the argument, and one
 * clause × nine tools is ~290 chars per connection spent advertising an
 * argument nobody should newly adopt.
 *
 * ⚠ **THE DEPRECATION IS ANNOUNCED ON THE RESULT INSTEAD** — see
 * {@link deprecatedAliasNote}, which reaches exactly the caller that used it,
 * which is the caller that has to change. The ruling asks for "a one-line
 * deprecation note in the op result when used"; this is that line, and the
 * schema is deliberately not a second copy of it.
 *
 * ⚠ AN AGENT READING THE SCHEMA SEES ONE DESCRIBED ADDRESS ARGUMENT
 * (`container`) AND ONE BARE KEY. That is the intended reading: the alias
 * exists for callers that already know it, not for new ones to discover.
 */
export const WORKSPACE_ALIAS_DESCRIPTION = undefined;

/**
 * 🔒 **WHICH OPS STILL TAKE `workspace=` — the whole of B2/B13, as a table.**
 *
 * ⚠ **ONE QUESTION GENERATES EVERY ROW: can the SERVER find this op's container
 * from the argument the caller already passed?** Where an id resolves its own
 * tenancy (`src/shared/tenancy/resolve-resource.ts`, generalised in B2 to the
 * four `RESOURCE_TABLES` types) the answer is yes and the arg is retired. Where
 * the op ENUMERATES or MINTS inside a container, there is no id to follow and
 * the arg is the only way to say where — that is the `list`/`create` shape
 * Samuel's B2 ruling names.
 *
 * ⚠ **`null` MEANS "EVERY OP", AND IT IS A DEVIATION FROM "list/create only"
 * THAT IS RECORDED RATHER THAN HIDDEN.** The five tools carrying it do not name
 * a RESOURCE at all: a channel, an ontology object, a member and a workspace
 * manifest are properties OF a container, every one of their routes is
 * `withWorkspaceAuth`, and none of the four resource tables can answer for them.
 * Retiring the arg there would not move the question to an id — it would delete
 * the only way to address a home channel, which is the product.
 *
 * ⚠ **A ROW IS NOT A CLAIM THAT THE OP IS A WRITE OR A READ.** That is
 * `gating.ts › WRITE_OPS`, a different question over the same enum.
 *
 * ⚠ Keys are the same grain `Gates.requestedOp` produces — the bare op, or
 * `<op>.<action>` where the tool takes one. `server.test.ts` pins every key
 * against the live enum in both directions, so a renamed op cannot leave a
 * stale row and a new op cannot join unclassified.
 */
export const WORKSPACE_ARG_OPS: Record<string, ReadonlySet<string> | null> = {
  // ── The four types whose ids resolve their own tenancy (B2) ──────────────
  // ⚠ `search` is a LIST: it has no ref to follow, so it must be told where.
  dopl_kb: new Set(["list_bases", "create_base", "search"]),
  dopl_skill: new Set(["list", "create"]),
  // ⚠ `export` MINTS a chat, so it is a create; `folders` lists them.
  dopl_chats: new Set(["list", "folders", "export", "create_folder"]),
  dopl_agent: new Set(["list", "create"]),
  // ── The five that name a CONTAINER, not a resource ───────────────────────
  dopl_channel: null,
  dopl_ontology: null,
  dopl_members: null,
  dopl_map: null,
  dopl_search: null,
};

/**
 * 🔒 **WHERE `workspace=` IS HONOURED, AS A SENTENCE — RENDERED FROM THE TABLE
 * ABOVE AND NEVER RETYPED.** The mint's success line has to tell an operator's
 * agent what to do with the container id it was just handed, and it said *"on
 * any other tool"* until 2026-09-02: false on the day B13 shipped, because the
 * arg is IGNORED everywhere outside this table. A hand-written list would be the
 * same claim one release later, so it is derived — a row added above changes
 * this sentence with it.
 */
export function workspaceArgTargets(): string {
  return Object.entries(WORKSPACE_ARG_OPS)
    .map(([tool, ops]) => (ops === null ? tool : `${tool} (${[...ops].join(", ")})`))
    .join(", ");
}

/**
 * Does this op still take `workspace=`? ⚠ A tool with NO row takes it nowhere —
 * fail closed, so a tool added without a row cannot silently inherit routing.
 */
export function acceptsWorkspaceArg(
  tool: string,
  op: string | undefined,
): boolean {
  const ops = WORKSPACE_ARG_OPS[tool];
  if (ops === undefined) return false;
  return ops === null || (op !== undefined && ops.has(op));
}

/**
 * 🔒 **THE ONE-RELEASE IGNORE, SAID OUT LOUD** (B13). A `workspace=` on an op
 * that no longer takes one is dropped, never refused — and a drop nobody is
 * told about is indistinguishable from a call that landed where it was aimed.
 * This is the whole difference between a deprecation window and a silent
 * re-target, so it rides the footer the instructions already tell every agent
 * to read.
 *
 * ⚠ THE REF IS THE CALLER'S OWN STRING and is neutralized like every other
 * value spliced into a line this server wrote.
 */
/**
 * 🔒 **WHICH OPS REFUSE AN UNADDRESSED WRITE** (R-32 item 4; Samuel: Skills and
 * Chats stay out of home, and *a chat filed where nothing lists it is an
 * orphan*).
 *
 * ⚠ **ONE QUESTION GENERATES EVERY ROW, AND IT IS NOT "IS THIS A WRITE":** does
 * this op MINT a row inside a container that the caller never named? Those are
 * exactly the ops that appear in BOTH {@link WORKSPACE_ARG_OPS} (no id to
 * follow — the container is the only address) and `gating.ts › WRITE_OPS`. An
 * update, a move or a post carries a resource or channel id that resolves its
 * own tenancy, so there is nothing for it to land in by accident.
 *
 * ⚠ **AND THE REFUSAL FIRES ONLY WHERE THE DEFAULT WOULD BE `home`.** A
 * connection bound to a container (`X-Workspace-Id`) HAS named one, at the
 * transport instead of in the arguments, and its writes land where the operator
 * pointed it. What R-32 refuses is the silent fall-through to the personal
 * container — the path that produced the orphan. Reads still default to home,
 * unchanged.
 *
 * ⚠ Keys are the same grain as {@link WORKSPACE_ARG_OPS}; `workspace-arg.test.ts`
 * pins every row against the live enum AND against `WRITE_OPS`, so a row cannot
 * name a read and a mint cannot join unclassified.
 */
export const UNADDRESSED_WRITE_REFUSALS: Record<string, ReadonlySet<string>> = {
  dopl_kb: new Set(["create_base"]),
  dopl_skill: new Set(["create"]),
  // ⚠ `export` IS THE ONE THE RULING NAMES. It mints a chat, and the home space
  // has no Chats face (R-33: Skills and Chats stay out of home), so an
  // unaddressed export filed a row NOTHING in the product lists.
  dopl_chats: new Set(["export", "create_folder"]),
  dopl_agent: new Set(["create"]),
};

/** Does this op refuse to run without an explicit address? */
export function refusesUnaddressedWrite(
  tool: string,
  op: string | undefined,
): boolean {
  const ops = UNADDRESSED_WRITE_REFUSALS[tool];
  return ops !== undefined && op !== undefined && ops.has(op);
}

/**
 * 🔒 **THE REFUSAL ITSELF — it names the op, the reason and the way out.** ⚠ It
 * offers `container="home"` explicitly rather than pretending the home space is
 * unreachable: the ruling refuses the SILENT default, not the deliberate
 * choice, and a refusal with no accepted value is a dead end an agent retries.
 */
export function unaddressedWriteRefusal(tool: string, op: string): string {
  return (
    `\`${tool}(op="${op}")\` needs an explicit \`container=\`. This connection names no ` +
    `container, so the write would fall through to your home space — which lists no ` +
    `chats and no skills, and a row filed where nothing lists it is an orphan. Pass ` +
    `\`container=<slug|id>\` (\`dopl_workspaces\` lists every one you can reach), or ` +
    `\`container="home"\` if the home space is genuinely where you mean it to go.`
  );
}

/**
 * 🔒 **THE ONE-RELEASE ALIAS, SAID OUT LOUD.** `workspace=` was honoured and is
 * still honoured; what changed is that it has a successor, so the caller that
 * sent it is told which argument to send next time. ⚠ On the RESULT, for the
 * same reason {@link ignoredWorkspaceNote} is: a deprecation nobody is told
 * about is a deprecation that surprises somebody at removal.
 */
export function deprecatedAliasNote(): string {
  return "container_arg: `workspace=` is DEPRECATED and was mapped to `container=` for this call. Pass `container=` — it takes the same ids and slugs, plus `home`. The alias retires next release.";
}

export function ignoredWorkspaceNote(
  op: string | undefined,
  ref: string,
  /** Which spelling the caller actually sent — `container` since R-32, or the
   *  deprecated `workspace`. ⚠ Defaulted, so the note a caller reads names the
   *  argument THEY passed rather than the one this file was named after. */
  arg: "workspace" | "container" = "workspace",
): string {
  return `${arg}_arg: IGNORED${op ? ` on ${op}` : ""} — ${inlineOr(
    ref,
    "`(blank)`",
  )} was not used; the id resolves its own container. The argument retires here next release.`;
}

/**
 * Both spellings on one call: `container=` wins and the alias is dropped. ⚠ Said
 * out loud for the same reason every other drop on this surface is — a caller
 * that sent two addresses must not have to guess which one the call used.
 */
export function aliasIgnoredNote(): string {
  return "container_arg: `workspace=` was IGNORED — `container=` was passed too and wins. Drop the alias; it retires next release.";
}
