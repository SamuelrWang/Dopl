/**
 * `dopl_home` — THE CALLER'S OWN HOME CHANNELS, and the only surface that hands
 * out the handle every other tool takes as `workspace=` for one.
 *
 * ── WHY IT IS NOT `list_workspaces`, AND WHY IT IS NOT A DOMAIN TOOL ────────
 *
 * A home channel is a hidden `kind='link'` CONTAINER workspace. It is unlistable
 * BY DESIGN: `workspace-directory.ts › getWorkspaceList` filters through
 * `isStandardWorkspace`, and INVARIANTS §4A forbids advertising a container as a
 * workspace anywhere. **Do not loosen that predicate** — it is a positive test
 * precisely so a future `kind` cannot leak into it (F-295), and four consumers
 * share it. This tool answers containers as what they ARE to the operator:
 * home channels, each carrying the container id that addresses it.
 *
 * ⚠ IT REGISTERS ON THE META PATH BUT IS CHARGED (Samuel's ruling Q2 (b),
 * 2026-08-28). Meta, because the domain path injects a `workspace=` argument and
 * this is the tool that makes such an argument answerable — publishing one here
 * would be an argument that can only ever be wrong. Charged, because unlike the
 * two orientation tools it reads content-adjacent data and WRITES. The charge is
 * written explicitly in `registrar.ts › registerMetaTool`, not folded into a
 * shared wrapper.
 *
 * 🔒 THE LOCK. `home-scopes.ts › listHomeChannels` narrows to `lockedTo`; a
 * container-locked session sees exactly the room it is standing in and no
 * evidence that another exists. Reading `client.getHomeChannels()` directly from
 * here would void B3's whole point.
 */

import { z } from "zod";
import type { DoplClient, HomeChannel } from "@dopl/client";
import { inlineOr } from "./narration.js";
import { ok, missingParams, type ToolResponse } from "./respond.js";
import type { RegisterMetaTool } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { listHomeChannels } from "./home-scopes.js";

const NO_NAME = "`(unnamed)`";

const HOME_DESCRIPTION = `Your HOME CHANNELS — the one-to-one and small-group rooms on your account, outside any workspace. Each one is backed by a hidden container whose id is what every other tool takes as \`workspace=\`, so this is how you reach a home channel's knowledge, agents and messages at all. Set \`op\` to one of:
- "list_channels" — the home channels YOU are a member of. Each row carries the channel name, the CONTAINER ID to pass as \`workspace=\`, the channel id to pass to dopl_channel, who else is in it, and whether you are alone. Rows come from your own membership, so this is your account's view and never a directory of anybody else's rooms.
- "create_channel" — make a new home channel. You land in it ALONE; that is a finished state, not a half-built one — it is where you talk to your own agents. Requires: name.

WHAT THIS WILL NOT DO, and it is a fence rather than a gap: it cannot INVITE anyone. Adding a person to a home channel mints an invitation link that reaches a real human, which requires an interactive Dopl session and is refused over MCP for every role and token. So you can make the room and you cannot people it — ask the user to add someone from the Dopl app.

⚠ These are NOT workspaces and must not be reported as such. A workspace is a tenancy with members and roles; a home channel is a relationship. \`list_workspaces\` deliberately does not show them.`;

/**
 * ⚠ WHOSE VIEW THIS IS, on the RESULT. The list is the caller's own membership
 * rows, and under a container lock it is narrowed to ONE — so a short list is
 * not a claim about the account.
 */
const HOME_SCOPE_NOTE = `_Home channels you are a member of. A session pinned to a shared home channel sees THAT ONE only, so a single row can mean "you are locked to this room" rather than "you have one". This is not a workspace list — dopl_home rooms are absent from list_workspaces by design._`;

function renderChannel(channel: HomeChannel): string[] {
  const peers = channel.peers ?? [];
  const who =
    peers.length === 0
      ? "just you"
      : peers
          .map((p) => inlineOr(p.displayName ?? p.email, "`(unnamed member)`"))
          .join(", ");
  const lines = [
    `- ${inlineOr(channel.name, NO_NAME)} — ${who}`,
    //  ⚠ THE CONTAINER ID IS THE POINT OF THIS ROW. Every other tool takes it as
    //  `workspace=`; without it a home channel is unreachable, because nothing
    //  else on the surface lists one.
    `  workspace=\`${channel.workspaceId}\` · channel=\`${channel.channelId}\``,
  ];
  if (channel.lastMessagePreview) {
    // ⚠ A peer-authored message body, spliced into a line we wrote — a VALUE.
    lines.push(`  last: ${inlineOr(channel.lastMessagePreview, "`(empty)`")}`);
  }
  return lines;
}

async function opListChannels(
  client: DoplClient,
  directory: WorkspaceDirectory,
): Promise<ToolResponse> {
  const channels = await listHomeChannels(client, directory);
  if (channels.length === 0) {
    return ok(
      `No home channels. ${HOME_SCOPE_NOTE}\n\nCreate one with \`dopl_home(op='create_channel', name='…')\`.`,
    );
  }
  const lines = ["## Home channels\n"];
  for (const channel of channels) lines.push(...renderChannel(channel));
  lines.push("", HOME_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

/**
 * ⚠ THE FOLLOW-UP IS REFUSED BY DESIGN AND THE RESULT SAYS SO IMMEDIATELY. An
 * agent that makes a room and is not told it cannot invite anybody will look for
 * an invite op, then a link op, then a members op, and read each absence as a
 * broken connection. One sentence at creation time closes that loop.
 */
async function opCreateChannel(
  client: DoplClient,
  name: string,
): Promise<ToolResponse> {
  const { channel } = await client.createHomeChannel({ name });
  return ok(
    [
      `Created home channel ${inlineOr(channel.name, NO_NAME)}. You are in it alone.`,
      `Address it with workspace=\`${channel.workspaceId}\` on any other tool, and with channel=\`${channel.channelId}\` on dopl_channel.`,
      `⚠ You cannot add a person to it. Minting the invitation is an interactive-session act, refused over MCP for every role and token — ask the user to add someone from the Dopl app.`,
    ].join("\n"),
  );
}

export function registerHomeTool(
  registerMetaTool: RegisterMetaTool,
  client: DoplClient,
  directory: WorkspaceDirectory,
): void {
  registerMetaTool(
    "dopl_home",
    HOME_DESCRIPTION,
    {
      op: z
        .enum(["list_channels", "create_channel"])
        .describe("Operation to perform."),
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe(
          'op="create_channel" (required): the channel\'s name, 1-80 characters. It names the room and its hidden container both — there is no second name to set.',
        ),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list_channels":
          return opListChannels(client, directory);
        case "create_channel": {
          const miss = missingParams("create_channel", args, ["name"]);
          if (miss) return miss;
          return opCreateChannel(client, args.name as string);
        }
      }
    },
    // ⚠ THE ONE CHARGED META TOOL. See this file's header and
    // `registrar.ts › registerMetaTool`.
    { charged: true },
  );
}
