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
 * 🔒 **VISIBILITY IS FORCED TO `private`, NEVER CARRIED.** The op creates "a
 * private copy in the target tenancy" by definition — and that also keeps it out
 * of THE CONFIRM CLASS (INVARIANTS §10) BY CONSTRUCTION, since the class is a
 * template landing at `visibility:"workspace"` inside a shared container. ⚠ So
 * this op is deliberately UN-GATED: it is not an exemption from the confirm
 * class, it is a write that can never enter it. If it ever learns to carry
 * visibility, it joins the class and needs `confirm-token.ts › confirmGate`.
 */

import { workspaceContext } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr } from "./narration.js";
import { ok, type ToolResponse } from "./respond.js";
import {
  isErr,
  NO_NAME,
  resolveTemplateOr,
  sharedCredentialPrivateDenied,
} from "./agent-shared.js";
import {
  isCopyRefusal,
  resolveCopyTarget,
  sameWorkspaceRefusal,
  workspaceHandle,
  workspaceLabel,
} from "./copy-target.js";

export async function opCopy(
  client: DoplClient,
  directory: WorkspaceDirectory,
  ref: string,
  toWorkspace: string,
): Promise<ToolResponse> {
  // ⚠ THE TARGET RESOLVES FIRST, so an unaddressable `to_workspace` costs one
  // cached directory read and no template read at all.
  const target = await resolveCopyTarget(directory, toWorkspace);
  if (isCopyRefusal(target)) return target;

  // Leg 1, part one: the ref resolves against what this caller may SEE here —
  // the existing three-answer resolver (one match / ambiguous-listing-both /
  // 404-never-403), never a second copy of it.
  const found = await resolveTemplateOr(client, ref);
  if (isErr(found)) return found;

  const onto = sameWorkspaceRefusal(
    target,
    found.workspaceId,
    "agent template",
    `dopl_agent(op="create")`,
  );
  if (onto) return onto;

  // Leg 1, part two: the DETAIL read, in the source's own scope. Explicit rather
  // than ambient so the two legs read as the pair they are, and so moving either
  // one cannot silently change which tenancy it runs against.
  const source = await workspaceContext.run(found.workspaceId, () =>
    client.getAgentTemplate(found.id),
  );

  // Leg 2: an ORDINARY create, fenced by `withWorkspaceAuth` in the target.
  let created;
  try {
    created = await workspaceContext.run(target.id, () =>
      client.createAgentTemplate({
        name: source.name,
        description: source.description,
        instructions: source.instructions,
        model: source.model,
        fields: source.fields,
        visibility: "private",
      }),
    );
  } catch (e) {
    const mapped = sharedCredentialPrivateDenied(e);
    if (mapped) return mapped;
    throw e;
  }

  const handle = workspaceHandle(target);
  const lines = [
    `Copied the agent template ${inlineOr(source.name, NO_NAME)} into ${workspaceLabel(target)} as a NEW template (id: \`${created.id}\`). It is PRIVATE to you there — a copy is never published into the target — and it is a STRANGER to the original: editing one never touches the other.`,
    `Address it with \`workspace="${handle}"\`, e.g. dopl_agent(op="get", template="${created.id}", workspace="${handle}").`,
  ];
  // ⚠ ONLY WHEN THERE IS SOMETHING TO WARN ABOUT. A "0 knowledge bases were not
  // carried" line on the common path is the noise that stops warnings being
  // read — the same argument the untrusted-content headers make (§10).
  if (source.knowledgeBases.length > 0) {
    const n = source.knowledgeBases.length;
    lines.push(
      `⚠ ${n} attached knowledge base${n === 1 ? " was" : "s were"} NOT carried, and the copy has none: a base id belongs to the workspace it was created in, so attaching it there would be a cross-tenancy reference this op refuses to make (and the target would reject it). Copy each across with dopl_kb(op="copy_base", base=…, to_workspace="${handle}"), then attach the NEW ids with dopl_agent(op="update", template="${created.id}", knowledge_bases=[…], workspace="${handle}").`,
    );
  }
  return ok(lines.join("\n"));
}
