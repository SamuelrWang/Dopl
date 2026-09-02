/**
 * meta-tools.ts — `list_workspaces` and `current_workspace`.
 *
 * ⚠ USER-scoped, not workspace-scoped: a membership lookup needs no workspace,
 * which is why they register through `registerMetaTool` (no injected
 * `workspace=` arg) and report the session default in their footer. Everything
 * else the domain path enforces — the four gates, `strictInput` — applies
 * identically; see `registrar.ts`.
 */

import { z } from "zod";
import { callerStatusLine, sessionLines, type CallerIdentity } from "./tools/identity.js";
import { inlineOr } from "./tools/narration.js";
import { err, type RegisterTool, type ToolResponse } from "./tools/respond.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";
import { clearSessionPin, writeSessionPin } from "./session-pin.js";
import type {
  ActiveWorkspaceState,
  WorkspaceDirectory,
} from "./workspace-directory.js";

export interface MetaToolDeps {
  directory: WorkspaceDirectory;
  /** Session default workspace resolved at boot, or null (0/2+ memberships). */
  activeWorkspace: ActiveWorkspaceState | null;
  caller: CallerIdentity;
  /**
   * 🔒 The workspace pin's opaque store key (`session-pin.ts`). ⚠ ABSENT IS A
   * REFUSAL, NOT A NO-OP: a transport that cannot identify its session has
   * nowhere to store a default, and reporting one anyway would stop an agent
   * passing `workspace=` on the strength of a pin that does not exist.
   */
  sessionKey?: string;
}

// Two read-only tools: discover your workspaces, and see (or SET) what a no-arg
// call resolves to.
//
// ⚠ **`current_workspace` GAINED A STICKY DEFAULT ON 2026-09-01 (T41), AND THIS
// COMMENT USED TO SAY IT COULD NOT EXIST.** It read: *"Targeting is PER-CALL only
// … There is no sticky `set_workspace` — the connection is stateless, so a
// 'switch' could not persist."* Statelessness is real — `/api/mcp` runs
// `sessionIdGenerator: undefined` and `bootServer` boots per HTTP REQUEST — but
// the conclusion did not follow: the PROCESS outlives the request, which is the
// same seam `tools/confirm-token.ts` already stores its tokens in. The pin is
// therefore best-effort and FAIL-CLOSED (a pin the next process never sees is
// simply no pin, i.e. the old refusal), never durable state. See
// `session-pin.ts` for the whole argument.
export function registerWorkspaceMetaTools(
  registerMetaTool: RegisterTool,
  { directory, activeWorkspace, caller, sessionKey }: MetaToolDeps,
): void {
  /**
   * Caller identity as a standalone block, for the meta-tools whose answers can
   * be read without a footer. ⚠ Same record and wording as the footer and
   * `whoami` — one definition, so two surfaces cannot disagree about a session.
   */
  function callerBlock(): string[] {
    return [...sessionLines(caller), callerStatusLine(caller).trim(), ""];
  }

  /**
   * 🔒 PIN A DEFAULT — FAIL CLOSED AT EVERY STEP.
   *
   * Three refusals, and none of them pins anything: no ref, a ref that resolves
   * to no active membership (`resolveWorkspaceRef` is also where the CONTAINER
   * LOCK answers, so a locked session can pin only its own container), and no
   * session key to store it against.
   *
   * ⚠ **IT DOES NOT MOVE *THIS* CALL'S TARGET, AND THE RESULT SAYS SO.** The
   * session default is resolved once at boot and never mutated (`server.ts`), so
   * the pin governs the NEXT call. An agent told only "pinned" would read the
   * footer under this very response — which still names the old target — as the
   * pin having failed.
   */
  async function opSetPin(ref?: string): Promise<ToolResponse> {
    const target = ref?.trim();
    if (!target) {
      return err(
        'op="set" needs `workspace`. Pass a slug or UUID from `list_workspaces`, or a home-channel container id from dopl_home(op="list_channels"). Nothing was pinned.',
      );
    }
    let resolved;
    try {
      resolved = await directory.resolveWorkspaceRef(target);
    } catch (e) {
      return err(
        `Couldn't validate that workspace (${inlineOr(
          e instanceof Error ? e.message : String(e),
          "`no detail reported`",
        )}). Nothing was pinned — retry, or keep passing \`workspace=\` per call.`,
      );
    }
    if (!resolved) {
      // ⚠ Caller's own argument, but a raw backtick still escapes this span.
      return err(
        `Workspace not found: ${inlineOr(target, "`(unreadable ref)`")}. Nothing was pinned. Call \`list_workspaces\` for the workspaces you can target, or dopl_home(op="list_channels") for your home channels.`,
      );
    }
    if (!writeSessionPin(sessionKey, resolved.id)) {
      return err(
        `This connection cannot hold a default — it did not arrive with anything identifying the session, so there is nowhere to store a pin. Nothing was pinned. Keep passing \`workspace=<slug_or_id>\` on each call.`,
      );
    }
    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Pinned ${inlineOr(resolved.name, UNNAMED_WORKSPACE)} (slug: \`${resolved.slug}\` · id: \`${resolved.id}\`) as this connection's default workspace.`,
            `⚠ FROM YOUR NEXT CALL ON, not this one — this response's own \`_dopl_status\` footer still names the target that was resolved before the pin existed. A no-\`workspace=\` call now lands in the pinned workspace, and a per-call \`workspace=\` still wins over it.`,
            `⚠ IT IS BEST-EFFORT AND IT EXPIRES. The pin lives in the server process that answered this call, so a later call may be refused for want of a workspace anyway — if that happens, set it again rather than concluding the pin was wrong. \`current_workspace(op="clear")\` removes it.`,
          ].join("\n"),
        },
      ],
    };
  }

  async function opClearPin(): Promise<ToolResponse> {
    const had = clearSessionPin(sessionKey);
    return {
      content: [
        {
          type: "text" as const,
          text: had
            ? `Cleared this connection's pinned default workspace. From your next call on, a no-\`workspace=\` call resolves the way it did before the pin — which, if you belong to 2+ workspaces, means it is refused and asks you to name one.`
            : `There was no pinned default to clear on this connection, so nothing changed.`,
        },
      ],
    };
  }

  registerMetaTool(
    "list_workspaces",
    "List every workspace the authenticated user is an active member of, with the user's role on each (owner/admin/member/viewer/guest). Use when the user mentions a workspace by name and you don't know its slug, or when reporting available workspaces. Pass a chosen workspace as the `workspace=` arg on subsequent tool calls. Result is cached per-session for ~60s.",
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
    "Report WHO this connection is and which workspace a no-`workspace=` tool call resolves to. Answers with your own immutable user id and your session's runtime, then the target workspace (id, slug, name, role) when the caller has exactly one membership (or a request pin); when the caller belongs to 2+ workspaces there is NO auto-target, and this lists them with ids so you can pick one to pass as `workspace=`. Use when the user asks 'which workspace am I in?' or 'who am I?' — for your role, teams and the full locus caveats use dopl_members(op='whoami'). op=\"set\" PINS one workspace (or home-channel container) as this connection's default so you stop passing `workspace=` on every call, and op=\"clear\" undoes it; a per-call `workspace=` still overrides the pin, and the pin is best-effort — if a later call is refused for want of a workspace, set it again.",
    {
      op: z
        .enum(["get", "set", "clear"])
        .optional()
        .describe(
          'Default "get" — report the current target. "set" pins a default for the rest of this connection (requires `workspace`); "clear" removes the pin.',
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          'op="set" (required): the workspace slug or UUID to make this connection\'s default — or a HOME CHANNEL container id from dopl_home(op="list_channels"), which is a legal target here exactly as it is for a per-call `workspace=`. A ref that does not resolve to one of your active memberships is REFUSED and nothing is pinned.',
        ),
    },
    async (args) => {
      if (args.op === "set") return opSetPin(args.workspace);
      if (args.op === "clear") return opClearPin();
      // ⚠ Caller line per branch: with a session default the footer already
      // carries it (rendering here too prints the caller twice); without one
      // `appendDoplStatus` returns early and the response carries NO identity —
      // exactly the state an agent is in when it reaches for this tool.
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
        // ⚠ Id joins the slug here as everywhere else — this is the surface an
        // agent reaches for when it does not know where it is, so it must not
        // withhold the handle nobody can forge.
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
