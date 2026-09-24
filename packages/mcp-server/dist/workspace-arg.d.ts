/**
 * workspace-arg.ts — 🔒 **WHERE `workspace=` STILL MEANS ANYTHING, AND WHAT IS
 * SAID WHEN IT DOES NOT.** The registrar is the mechanism; this file is the
 * policy, so the one question B2 and B13 answer — *can the server find this
 * op\'s container without being told?* — is settled in one place and pinned by
 * one suite (`workspace-arg.test.ts`).
 */
import { type BindingKey } from "./tool-manifest.js";
/**
 * 🔒 **THE `container=` ARGUMENT'S DESCRIPTION — R-32's ADDRESS GRAMMAR IN ONE
 * LINE** (Samuel, 2026-09-17).
 *
 * ⚠ IT IS THE ONLY ADDRESSING ARGUMENT ON THE NINE DOMAIN SCHEMAS SINCE
 * 2026-09-18 (the `workspace=` alias retired; see the note below) AND IS PAID
 * FOR NINE TIMES, so the rule is: the FULL contract is stated once, in
 * `instructions.ts`, and is not restated here.
 *
 * ⚠ **THE DEFAULT IS NAMED, AND THAT IS THE BUDGET-NEUTRAL HALF OF THE
 * RULING.** "home is structural, never a prompt line" means the resolver
 * decides it; what the agent still cannot derive from anywhere else is WHICH
 * container an omitted argument lands in, and a few words say it.
 *
 * 🔒 **AND `home` IS NOT "YOUR DEFAULT" — IT SAID SO UNTIL 2026-09-18, AND THAT
 * WAS FALSE FOR EVERY AGENT RUNNING INSIDE A CHANNEL.** A connection bound to a
 * container (`X-Workspace-Id`) lands THERE, which `instructions.ts` states
 * correctly on the very same connection — *"every call lands there unless it
 * names another"*. Two served strings disagreeing about where an unaddressed
 * create goes is how the orphan class got minted: an agent reading "your
 * default" believed its bare `op="create"` landed on its own shelf while it was
 * landing in the channel's container. **The two strings now say one thing**, and
 * they say it in ONE place: this string names what `home` IS, and where an
 * OMITTED argument lands is `instructions.ts`'s sentence — *"every call lands
 * there unless it names another"* — which is pushed once and knows whether this
 * connection is bound. ⚠ The ceiling below this file is a ratchet that only
 * moves down (`container-addressing.test.ts › CONTAINER_ARG_MAX_CHARS`), so
 * restating it here was never the available fix.
 */
export declare const CONTAINER_ARG_DESCRIPTION = "Container for list/create: slug, id, or `home` (home space). Ignored elsewhere.";
/**
 * 🔒 **THE ALIAS IS RETIRED (2026-09-18), AND THIS NOTE IS WHAT IS LEFT OF IT.**
 *
 * `workspace=` was published for ONE release as a bare, undescribed key so that
 * a caller that already knew the old spelling got its answer rather than a
 * `-32602`; the deprecation was announced on the RESULT, to exactly the caller
 * that used it. That release shipped. The key is now gone from
 * `registrar.ts › WORKSPACE_ARG_SHAPE`, so `strictInput` answers it with
 * `-32602 … Unrecognized key: "workspace"` — which names the field, which is
 * how a calling agent corrects itself.
 *
 * ⚠ **THE 189 CHARACTERS IT COST ARE WHAT PAID FOR THIS WAVE** (21 per schema ×
 * 9 domain tools, pushed on every connection). ⚠ **AND THE WINDOW IS THE
 * PRECEDENT, NOT THE ALIAS**: a renamed argument ships as a bare key for one
 * release, says so on the result, and is then DELETED — a deprecation with no
 * end is a second name for the same argument, paid for forever.
 */
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
 * 🔒 **WHERE `workspace=` IS HONOURED, AS A SENTENCE — RENDERED FROM THE TABLE
 * ABOVE AND NEVER RETYPED.** The mint's success line has to tell an operator's
 * agent what to do with the container id it was just handed, and it said *"on
 * any other tool"* until 2026-09-02: false on the day B13 shipped, because the
 * arg is IGNORED everywhere outside this table. A hand-written list would be the
 * same claim one release later, so it is derived — a row added above changes
 * this sentence with it. A granular connection gets the granular tools that
 * publish `container` (a bound job honours it), named whole.
 */
export declare function workspaceArgTargets(): string;
/** Does the legacy job a granular binding runs take `container`? */
export declare function bindingTakesContainer(key: BindingKey): boolean;
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
export declare const UNADDRESSED_WRITE_REFUSALS: Record<string, ReadonlySet<string>>;
/** Does this op refuse to run without an explicit address? */
export declare function refusesUnaddressedWrite(tool: string, op: string | undefined): boolean;
/**
 * 🔒 **THE REFUSAL ITSELF — it names the op, the reason and the way out.** ⚠ It
 * offers `container="home"` explicitly rather than pretending the home space is
 * unreachable: the ruling refuses the SILENT default, not the deliberate
 * choice, and a refusal with no accepted value is a dead end an agent retries.
 */
export declare function unaddressedWriteRefusal(tool: string, op: string): string;
/**
 * ⚠ **ONE SPELLING SINCE THE ALIAS RETIRED (2026-09-18)**, so the note names
 * `container` unconditionally: the other spelling no longer reaches a handler —
 * it is refused at the schema with its own name in the message.
 */
export declare function ignoredWorkspaceNote(op: string | undefined, ref: string): string;
