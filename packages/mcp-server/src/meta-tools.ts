/**
 * meta-tools.ts — `list_workspaces` and `current_workspace`.
 *
 * Split out of `server.ts` (§2, the 2026-07-20 op-dispatch precedent: the
 * registrar stays thin and the handlers are siblings). These two are the only
 * tools `server.ts` itself authored — every other tool comes from a registrar
 * under `tools/` — so they are the ones that made the registrar fat.
 *
 * They are USER-scoped, not workspace-scoped: a membership lookup does not need
 * a workspace, which is why they register through `registerMetaTool` (no
 * injected `workspace=` arg) and report the session default in their footer.
 * Everything else the domain path enforces — the four gates, `strictInput` —
 * applies to them identically; see `registrar.ts`.
 */

import { callerStatusLine, sessionLines, type CallerIdentity } from "./tools/identity.js";
import { inlineOr } from "./tools/narration.js";
import type { RegisterTool } from "./tools/respond.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";
import type {
  ActiveWorkspaceState,
  WorkspaceDirectory,
} from "./workspace-directory.js";

export interface MetaToolDeps {
  directory: WorkspaceDirectory;
  /** Session default workspace resolved at boot, or null (0/2+ memberships). */
  activeWorkspace: ActiveWorkspaceState | null;
  caller: CallerIdentity;
}

// ── Workspace directory tools (M-2) ───────────────────────────────
// Two read-only tools that let the agent discover its workspaces and
// see what a no-arg call resolves to. Targeting is per-call only: pass
// the `workspace=` arg injected by `registerTool` (M-1). There is no
// sticky `set_workspace` — the connection is stateless, so a "switch"
// couldn't persist anyway.
export function registerWorkspaceMetaTools(
  registerMetaTool: RegisterTool,
  { directory, activeWorkspace, caller }: MetaToolDeps,
): void {
  /**
   * The caller's own identity as a standalone block, for the meta-tools whose
   * answers can be read without a footer. Same record, same wording as the
   * footer and as `whoami` — one definition, so two surfaces cannot drift into
   * disagreeing about the same session.
   */
  function callerBlock(): string[] {
    return [...sessionLines(caller), callerStatusLine(caller).trim(), ""];
  }

  registerMetaTool(
    "list_workspaces",
    "List every workspace the authenticated user is an active member of, with the user's role on each (owner/admin/member/viewer). Use when the user mentions a workspace by name and you don't know its slug, or when reporting available workspaces. Pass a chosen workspace as the `workspace=` arg on subsequent tool calls. Result is cached per-session for ~60s.",
    {},
    async () => {
      const list = await directory.getWorkspaceList();
      if (list.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "You're not an active member of any workspaces yet.",
            },
          ],
        };
      }
      const lines = [
        "Workspaces you have access to:",
        "",
        UNTRUSTED_DIRECTORY_NOTE,
        "",
      ];
      for (const w of list) {
        const star = w.id === activeWorkspace?.id ? " ★" : "";
        lines.push(
          `- ${inlineOr(w.name, UNNAMED_WORKSPACE)} (slug: \`${w.slug}\` · id: \`${w.id}\`, role: ${w.role})${star}`,
        );
      }
      lines.push("");
      if (activeWorkspace) {
        lines.push("★ = the workspace a no-arg call auto-targets.");
      } else {
        lines.push(
          "You belong to 2+ workspaces, so there is no auto-target — pass `workspace=<slug_or_id>` on every tool call.",
        );
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  registerMetaTool(
    "current_workspace",
    "Report WHO this connection is and which workspace a no-`workspace=` tool call resolves to. Answers with your own immutable user id and your session's runtime, then the target workspace (id, slug, name, role) when the caller has exactly one membership (or a request pin); when the caller belongs to 2+ workspaces there is NO auto-target, and this lists them with ids so you can pick one to pass as `workspace=`. Use when the user asks 'which workspace am I in?' or 'who am I?' — for your role, teams and the full locus caveats use dopl_members(op='whoami').",
    {},
    async () => {
      // WHERE THE CALLER LINE COMES FROM, per branch. With a session default
      // the footer fires and already carries it, so rendering it here too would
      // print the caller twice in one response. Without one — the 2+-membership
      // branch below — `appendDoplStatus` returns early and the response would
      // carry no identity at all, which is precisely the state an agent is in
      // when it reaches for this tool. So: footer when there is one, rendered
      // here when there is not, one definition either way.
      if (activeWorkspace) {
        const lines = [
          `A no-\`workspace=\` call targets ${inlineOr(activeWorkspace.name, UNNAMED_WORKSPACE)}:`,
          `- slug: \`${activeWorkspace.slug}\``,
          `- id: \`${activeWorkspace.id}\``,
          `- your role: ${activeWorkspace.role}`,
        ];
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      }
      // No session default → surface the directory so the agent can pick.
      const list = await directory.getWorkspaceList();
      if (list.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "You're not an active member of any workspace yet, so no tool call can resolve a target.",
            },
          ],
        };
      }
      const lines = [
        ...callerBlock(),
        `You belong to ${list.length} workspaces and there is no auto-target — pass \`workspace=<slug_or_id>\` on every tool call. Choices:`,
        "",
        UNTRUSTED_DIRECTORY_NOTE,
        "",
      ];
      for (const w of list) {
        // The id joins the slug here as it does everywhere else. This branch
        // used to print the slug alone, so the one surface an agent reaches for
        // when it does not know where it is was also the one that withheld the
        // handle nobody can forge.
        lines.push(
          `- ${inlineOr(w.name, UNNAMED_WORKSPACE)} (slug: \`${w.slug}\` · id: \`${w.id}\`, role: ${w.role})`,
        );
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
