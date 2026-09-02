/**
 * `dopl_agent(op="copy")` — an operator's own agent template, re-created as a
 * PRIVATE copy in another tenancy. Routed from the registrar in `agent.ts`.
 *
 * 🔒 **TWO ORDINARY, ALREADY-FENCED LEGS, AND THAT IS THE WHOLE DESIGN.** Leg 1
 * reads the source in the workspace the call is already in; leg 2 creates in the
 * target, inside its own `workspaceContext.run(...)`. Neither leg is a new authz
 * path, which is why this ticket ships no migration and no route — the full
 * argument lives in `copy-target.ts`'s header and is not restated here.
 *
 * ── WHAT CROSSES, AND THE TWO THINGS THAT DELIBERATELY DO NOT ─────────────
 *
 * CARRIED: `name`, `description`, `instructions`, `model`, `fields` — the
 * identity itself, which is what an operator means by "copy this agent".
 *
 * 🔒 **`knowledge_bases` IS NOT CARRIED.** A base id from the source workspace is
 * a CROSS-TENANCY REFERENCE, the exact thing this op must not create, and the
 * target's own create path would refuse it anyway: every attached id must be one
 * the caller can read IN THAT WORKSPACE (`agent-shared.ts ›
 * knowledgeBaseNotAttachable`). ⚠ The result NAMES the dropped attachments by
 * count — an agent that is not told will believe its copy carries its knowledge,
 * and a template whose instructions reference documents it cannot see is worse
 * than one that never claimed them.
 *
 * 🔒 **THE SOURCE MUST BE THE CALLER'S OWN (R2, 2026-09-02).** Readable is not
 * owned: a copy lands PRIVATE to the copier in the target, so copying a
 * teammate's `workspace`-visible template would move their work into a room they
 * may not be in. `copy-target.ts › notOwnedRefusal` is the fence, and it fails
 * closed on an unprovable owner.
 *
 * 🔒 **VISIBILITY IS FORCED TO `private`, NEVER CARRIED.** The op creates "a
 * private copy in the target tenancy" by definition — and that also keeps it out
 * of THE CONFIRM CLASS (INVARIANTS §10) BY CONSTRUCTION, since the class is a
 * template landing at `visibility:"workspace"` inside a shared container. ⚠ So
 * this op is deliberately UN-GATED: it is not an exemption from the confirm
 * class, it is a write that can never enter it. If it ever learns to carry
 * visibility, it joins the class and needs `confirm-token.ts › confirmGate`.
 */
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond.js";
export declare function opCopy(client: DoplClient, directory: WorkspaceDirectory, selfUserId: string | null, ref: string, toWorkspace: string): Promise<ToolResponse>;
