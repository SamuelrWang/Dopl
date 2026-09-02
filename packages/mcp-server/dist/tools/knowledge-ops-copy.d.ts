/**
 * `dopl_kb(op="copy_base")` — a knowledge base the caller can read, re-created
 * as a PRIVATE base in another tenancy, folders and entries and all. Routed from
 * the registrar in `knowledge.ts`.
 *
 * 🔒 **TWO ORDINARY, ALREADY-FENCED LEGS, AND THAT IS THE WHOLE DESIGN.** Leg 1
 * reads the source in the workspace the call is already in; leg 2 creates in the
 * target, inside its own `workspaceContext.run(...)`. Neither leg is a new authz
 * path, which is why this ticket ships no migration and no route — the full
 * argument lives in `copy-target.ts`'s header and is not restated here.
 *
 * 🔒 **THE SOURCE MUST BE THE CALLER'S OWN (R2, 2026-09-02).** Readable is not
 * owned: the copy lands PRIVATE to the copier in the target, so copying a
 * teammate's shared base would move their documents into a room they may not be
 * in. `copy-target.ts › notOwnedRefusal` is the fence, it runs BEFORE the tree
 * read so a refusal costs no loopback traffic, and it fails closed on an
 * unprovable owner.
 *
 * ── THE THREE THINGS THIS OP REFUSES TO GUESS ─────────────────────────────
 *
 * 1. ⚠ **IT REFUSES ABOVE {@link MAX_COPY_ENTRIES} AND CREATES NOTHING**, and
 *    the check runs BEFORE the first write. See that constant for the argument.
 * 2. 🔒 **THE COPY LANDS `visibility: "private"` AND ON THE WORKSPACE SHELF.**
 *    Private because that is what the op is for, and it keeps the write out of
 *    THE CONFIRM CLASS (INVARIANTS §10) by construction — the class is a base
 *    landing `public` inside a shared container, which this can never do. ⚠ And
 *    NO `shelf`/`homeScoped` is sent: a shelf is set at create and never moved
 *    (F-342), and the personal-shelf fence wants the caller's OWN default
 *    workspace, so it would refuse a container target anyway
 *    (`shelf.ts › homeShelfForbidden`). Sending it could only ever turn a good
 *    copy into a 403.
 * 3. ⚠ **A MID-COPY FAILURE IS REPORTED AS PARTIAL, NEVER AS SUCCESS, AND IS
 *    NEVER ROLLED BACK.** There is no delete over MCP (§10), so an unwind is not
 *    available to this layer — and a silent retry would leave a SECOND
 *    half-written base. What the operator needs is the id of what exists, the
 *    counts that landed, and the sentence that says re-running makes a second.
 */
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond.js";
/**
 * ⚠ THE HARD CEILING ON ONE COPY, AND IT REFUSES RATHER THAN TRUNCATING.
 *
 * This op is N+M LOOPBACK REQUESTS ON ONE TOOL CALL — one body read per entry,
 * one write per entry, plus a create per folder — so an unbounded base turns a
 * single call into a hold. **A HALF-COPIED BASE IS WORSE THAN A REFUSAL**: the
 * operator cannot tell which half landed without diffing two trees by hand, and
 * nothing on this surface can delete the remains (§10). So the size is measured
 * from the TREE, before anything is written, and an oversized base is refused
 * whole with the count and the cap both named.
 */
export declare const MAX_COPY_ENTRIES = 100;
/**
 * How many entry bodies are read at once. ⚠ Bounded fan, never a long serial
 * chain and never an unbounded `Promise.all`: serial makes a 100-entry base a
 * hold, and unbounded points 100 concurrent loopback requests at one process.
 */
export declare const COPY_READ_BATCH = 8;
export declare function opCopyBase(client: DoplClient, directory: WorkspaceDirectory, selfUserId: string | null, ref: string, toWorkspace: string): Promise<ToolResponse>;
