/**
 * workspace-arg.ts — 🔒 **WHERE `workspace=` STILL MEANS ANYTHING, AND WHAT IS
 * SAID WHEN IT DOES NOT.** The registrar is the mechanism; this file is the
 * policy, so the one question B2 and B13 answer — *can the server find this
 * op\'s container without being told?* — is settled in one place and pinned by
 * one suite (`workspace-arg.test.ts`).
 */
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
export declare const WORKSPACE_ARG_DESCRIPTION = "Workspace or home-channel container for list/create; omit for this one. Ignored elsewhere.";
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
export declare const WORKSPACE_ARG_OPS: Record<string, ReadonlySet<string> | null>;
/**
 * Does this op still take `workspace=`? ⚠ A tool with NO row takes it nowhere —
 * fail closed, so a tool added without a row cannot silently inherit routing.
 */
export declare function acceptsWorkspaceArg(tool: string, op: string | undefined): boolean;
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
export declare function ignoredWorkspaceNote(op: string | undefined, ref: string): string;
