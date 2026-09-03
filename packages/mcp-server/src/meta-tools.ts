/**
 * meta-tools.ts — `dopl_workspaces`, the orientation tool.
 *
 * ⚠ USER-scoped, not workspace-scoped: a membership lookup needs no workspace,
 * which is why it registers through `registerMetaTool` (no injected
 * `workspace=` arg) and reports the connection's container in its footer.
 * Everything else the domain path enforces — the gates, `strictInput` — applies
 * identically; see `registrar.ts`.
 *
 * ── ⚠ THREE TOOLS BECAME ONE (B13, 2026-09-02) ─────────────────────────────
 *
 * `list_workspaces`, `current_workspace` and `dopl_home` answered three
 * questions that had stopped being three: *which containers am I in*, *which
 * one does a no-arg call hit*, and *which of them are home channels*. B10
 * deletes the middle one — there is no default workspace to report, because
 * "home is the default; all workspaces are just normal workspaces" — and with
 * it the reason the third existed. A home-channel container was hidden from
 * `list_workspaces` only because a listing was an advertisement of things a
 * no-arg call might silently pick; nothing picks now, so a container is simply
 * one more container the caller is in, LISTED WITH ITS KIND.
 *
 * ⚠ **WHAT LEFT WITH THEM, AND IT IS A SURFACE DECISION, NOT A TIDY-UP.**
 * `current_workspace(op="set"|"clear")` — the session pin — is gone with the
 * default it pinned. `dopl_home(op="create_channel")` is gone too: minting a
 * room is now an app act, which is what its own INVITE half already was.
 * Reading a home channel is unaffected — its container id is on every row here,
 * and `dopl_status` still answers for the rooms inside it.
 */

import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tools/tool-style.js";
import { sessionLines, type CallerIdentity } from "./tools/identity.js";
import { inlineOr } from "./tools/narration.js";
import type { RegisterMetaTool } from "./tools/respond.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";
import {
  containerKind,
  type ActiveWorkspaceState,
  type WorkspaceDirectory,
} from "./workspace-directory.js";

/**
 * ⚠ **RENDERED, NOT WRITTEN** (A14) — `tool-style.ts › composeDescription`
 * holds the order for all eleven tools, and refuses a headline over its window
 * or a description over its cap at import time.
 *
 * ⚠ IT IS BUDGETED AT {@link READ_DESCRIPTION_MAX_CHARS}, NOT THE DISPATCH CAP.
 * It takes no arguments at all — no `op` enum whose every member
 * `parity.test.ts` requires glossed, which is the only thing that gives a tool
 * a floor above 450.
 */
const WORKSPACES_DESCRIPTION = composeDescription({
  headline:
    "Every container you are in — workspaces AND home channels, each with its kind, its id and your role. Read-only, and the only place a container id is published.",
  policy: "Read-only.",
  routing: [
    "Use dopl_status for the rooms, sessions and unanswered asks inside them.",
  ],
  body: [
    "Pass an id or slug from here as `workspace=` when you list or create somewhere other than this connection's container.",
  ],
  examples: [{}],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

export interface MetaToolDeps {
  directory: WorkspaceDirectory;
  /** The container this connection is bound to, or null. */
  activeWorkspace: ActiveWorkspaceState | null;
  caller: CallerIdentity;
}

export function registerWorkspaceMetaTools(
  registerMetaTool: RegisterMetaTool,
  { directory, activeWorkspace, caller }: MetaToolDeps,
): void {
  /**
   * The CREDENTIAL this connection acts through, as a standalone block.
   *
   * ⚠ **IT IS THE SESSION LINE AND NOT THE CALLER LINE**, and the difference is
   * B13's: `appendDoplStatus` now renders `caller: id=…` on EVERY successful
   * response, bound container or not, so restating it here would print one
   * agent's identity twice in one answer. What the footer deliberately does NOT
   * carry is the credential label (a per-response tax on every result), and
   * that is exactly the fact somebody reaching for this tool is missing.
   */
  function callerBlock(): string[] {
    const lines = sessionLines(caller);
    return lines.length > 0 ? [...lines, ""] : [];
  }

  registerMetaTool("dopl_workspaces", WORKSPACES_DESCRIPTION, {}, async () => {
    const list = await directory.getWorkspaceList();
    if (list.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "You're not an active member of any container yet.",
          },
        ],
      };
    }
    const lines = [
      ...callerBlock(),
      "Containers you are in:",
      "",
      UNTRUSTED_DIRECTORY_NOTE,
      "",
    ];
    for (const w of list) {
      const kind = containerKind(w);
      // ⚠ KIND IS RENDERED, NOT INFERRED BY THE READER, and a container's SLUG
      // is withheld — its id is the only handle that addresses it, and printing
      // a slug beside a room would read as a second, equivalent address.
      const address =
        kind === "workspace"
          ? `slug: \`${w.slug}\` · id: \`${w.id}\``
          : `id: \`${w.id}\``;
      const here = w.id === activeWorkspace?.id ? " ←" : "";
      lines.push(
        `- ${inlineOr(w.name, UNNAMED_WORKSPACE)} — ${kind} (${address}, role: ${w.role})${here}`,
      );
    }
    lines.push("");
    lines.push(
      activeWorkspace
        ? "← this connection's container: a call that names none lands there."
        : // ⚠ NOT "you have no default" — there is no default to lack. The
          // server answers for a call that names nothing, and saying so is what
          // stops an agent hunting for a tool that would set one.
          "This connection names no container, so a call that names none is resolved for you. Pass `workspace=` to list or create somewhere specific.",
    );
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });
}
