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
import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tools/tool-style.js";
import { isStandardWorkspace } from "@dopl/client";
import { callerStatusLine, sessionLines, type CallerIdentity } from "./tools/identity.js";
import { inlineOr } from "./tools/narration.js";
import { err, type RegisterTool, type ToolResponse } from "./tools/respond.js";
import { UNNAMED_WORKSPACE, UNTRUSTED_DIRECTORY_NOTE } from "./instructions.js";
import { clearSessionPin, writeSessionPin } from "./session-pin.js";
import type {
  ActiveWorkspaceState,
  WorkspaceDirectory,
} from "./workspace-directory.js";

/**
 * ⚠ **RENDERED, NOT WRITTEN** (A14) — `tool-style.ts › composeDescription`
 * holds the order for all thirteen tools, and refuses a headline over its
 * window or a description over its cap at import time.
 *
 * ⚠ THESE TWO ARE BUDGETED AT {@link READ_DESCRIPTION_MAX_CHARS}, NOT THE
 * DISPATCH CAP. `list_workspaces` takes no arguments at all and
 * `current_workspace` takes two; neither has an `op` enum whose every member
 * `parity.test.ts` requires glossed, which is the only thing that gives a tool
 * a floor above 450.
 *
 * ⚠ **WHAT LEFT, AND IT IS NOT A FACT.** The old strings ran 804 and 1,011
 * chars and both spent most of it restating their own schema: which of
 * "set"/"clear" does what, that a container id is a legal target, the ~60s
 * cache. A description and its arg descriptions are BOTH pushed on every
 * connection, so that was one fact paid for twice — the same trade
 * `tool-budget.test.ts` records these two making on 2026-09-02, applied again.
 * The container rule itself survives because it is the one thing NEITHER schema
 * says: a container is addressable and is counted by nothing.
 */
const LIST_WORKSPACES_DESCRIPTION = composeDescription({
  headline:
    "The workspaces you are an active member of, with your role on each — NOT your home channels, which are containers this never lists.",
  policy: "Read-only.",
  routing: [
    'Use dopl_home(op="list_channels") for home channels and the container ids they take as `workspace=`.',
    "Use current_workspace for the one a no-arg call targets.",
  ],
  body: [
    '⚠ Containers count toward NOTHING — including the "2+ workspaces" rule that decides whether `workspace=` is required.',
  ],
  examples: [{}],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

const CURRENT_WORKSPACE_DESCRIPTION = composeDescription({
  headline:
    "Who this connection is, and which workspace a no-`workspace=` call resolves to — standard memberships only, never a home-channel container.",
  policy: 'Read-only; op="set"/"clear" pin this connection\'s default and change no data.',
  routing: ["Use dopl_members(op='whoami') for your role, teams and the locus caveats."],
  body: [
    "With 2+ standard memberships there is no auto-target and this lists them with ids to pick from.",
  ],
  examples: [{}, { op: "set", workspace: "alpha" }, { op: "clear" }],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

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
    LIST_WORKSPACES_DESCRIPTION,
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
      // 🔒 THE ONE ROW THAT IS NOT A WORKSPACE. This listing is
      // `isStandardWorkspace`-filtered by construction — EXCEPT under the
      // container lock, where `getWorkspaceList` answers `[lockedTo]` so a
      // locked session has a name to target (`workspace-directory.ts:143-151`,
      // deliberate). That one row is a `kind='link'` home channel, and rendering
      // it in the workspace shape said three false things at once: that it is a
      // workspace, that its slug is an address, and (via ★) that it is "the
      // workspace a no-arg call auto-targets".
      // ⚠ KIND IS RENDERED, NOT INFERRED BY THE READER, and the slug is withheld
      // — the same rule and the same shape as `tools/home-scopes.ts › searchLegs`
      // (a container's slug "is not advertised"). Ask the predicate rather than
      // assuming the source.
      let starred = false;
      for (const w of list) {
        if (!isStandardWorkspace(w)) {
          lines.push(
            `- ${inlineOr(w.name, UNNAMED_WORKSPACE)} — home channel (id: \`${w.id}\`, role: ${w.role})`,
          );
          continue;
        }
        const star = w.id === activeWorkspace?.id ? " ★" : "";
        if (star) starred = true;
        lines.push(
          `- ${inlineOr(w.name, UNNAMED_WORKSPACE)} (slug: \`${w.slug}\` · id: \`${w.id}\`, role: ${w.role})${star}`,
        );
      }
      lines.push("");
      if (starred) {
        lines.push("★ = the workspace a no-arg call auto-targets.");
      } else if (activeWorkspace) {
        // ⚠ NO ★ AND NO LEGEND: the auto-target is a home channel, not a
        // workspace, so the legend's own noun would be wrong. Said plainly
        // instead, with the id — which is the only handle that addresses it.
        lines.push(
          `A no-\`workspace=\` call targets the home channel above. It is addressed by id (\`workspace=${activeWorkspace.id}\`), never by slug.`,
        );
      } else {
        lines.push(
          "There is no auto-target — pass `workspace=<slug_or_id>` on every tool call. Home-channel containers are not listed here; reach one with `dopl_home(op=\"list_channels\")` and pass its container id as `workspace=`.",
        );
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  // ⚠ **THE DESCRIPTION IS UNDER `DESCRIPTION_MAX_CHARS` AND STAYS THERE**
  // (`channel-description.ts`; `tool-budget.test.ts` holds the number). It
  // measured 1,312 on 2026-09-02 — over the cap — after T41's pin paragraph
  // joined P3's standard-workspace caveat, and BOTH tiers' facts survive the
  // trim because neither was cut: what went was the half the `op` and
  // `workspace` SCHEMA DESCRIPTIONS below already say word for word (which of
  // "set"/"clear" does what; that a home-channel CONTAINER id is a legal target
  // here). A description and its own arg descriptions are both PUSHED on every
  // connection, so a fact stated in both is paid for twice — the rule
  // `channel-description.ts` states as "the arguments that are NOT
  // self-describing from their own `.describe()`".
  registerMetaTool(
    "current_workspace",
    CURRENT_WORKSPACE_DESCRIPTION,
    {
      op: z
        .enum(["get", "set", "clear"])
        .optional()
        .describe(
          'Default "get" — report the current target. "set" pins a default for the rest of this connection (requires `workspace`); "clear" removes the pin. A pin is BEST-EFFORT and a per-call `workspace=` beats it — if a later call is refused for want of a workspace, set it again.',
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          // ⚠ The home-channel rule is stated ONCE, in the tool description above
        // and in the server instructions (F-425) — it used to run here too, in
        // 330 chars pushed on every connection that never pins anything.
        'op="set" (required): the workspace slug or UUID — or a home-channel container id — to make this connection\'s default. A ref that does not resolve to one of your active memberships is REFUSED and nothing is pinned.',
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
        `You belong to ${list.length} workspaces and there is no auto-target — pass \`workspace=<slug_or_id>\` on every tool call. ⚠ These are your STANDARD workspaces; home channels are not counted or listed here, so if you are looking for one, ask \`dopl_home(op="list_channels")\` and pass its container id as \`workspace=\`. Choices:`,
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
