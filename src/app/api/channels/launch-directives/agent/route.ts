import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { AgentDirectiveCreateSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  createAgentDirective,
} from "@/features/channels/server/service";

/**
 * FILE AN AGENT-MANAGEMENT DIRECTIVE — an operator's own external agent asking
 * that operator's own desktop to **END** or **RENAME** one of its running agents
 * (2026-09-01, Samuel: *"dopl mcp being able to end agents. Dopl MCP need to be
 * able to do all that stuff"*).
 *
 * ⚠ **A SIBLING PATH ON ONE LANE, NOT A SECOND LANE.** The row it writes is a
 * `channel_launch_directives` row with `kind <> 'launch'`; `claim`, `decide`, the
 * by-id poll and the pending-collection backstop beside this file serve it
 * unchanged, because a directive's LIFECYCLE does not depend on which verb it
 * carries. ⚠ **THE CREATE IS THE ONE THING THAT COULD NOT BE SHARED**: the launch
 * create's body is a `channel` + `goal` + `model` + `template` shape and this one
 * is a `kind` + `agent_id` (+ `name`) shape, and folding both into one schema
 * would mean a POST that names a template AND an agent to end parses fine and
 * then has to be sorted out downstream.
 *
 * ⚠ **NOT `sessionOnly`, AND FOR THE CREATE'S REASON RATHER THAN THE DESKTOP
 * LANE'S.** The caller here IS an agent token — an external Claude Desktop /
 * Claude Code session over MCP — so a cookie gate would make the op unreachable
 * by the only caller it exists for. Read `../claim/route.ts` for the fuller
 * version of the argument; what differs here is the consent story, immediately
 * below.
 *
 * ── ⚠ THE CONSENT: THERE IS NO TOGGLE ON THESE TWO, AND THAT IS A RULING ──────
 *
 * `launch_agent`'s consent is the desktop's local `orchestratorLaunchEnabled`
 * toggle, and a machine with it off answers `no-bridge`. **`end` and `rename` are
 * deliberately NOT behind it.** `dopl-desktop-app/main/agent-self-ops.js` already
 * argues this in full for the in-process twins of the same two verbs, on the same
 * subjects: a STOP verb and a DISPLAY verb widen nothing — neither can start a
 * query, wake a shell, grant a tool or post — so the failure direction of an
 * abused call is an agent that stops or a card that reads differently, on the
 * machine of the operator whose agents they all are. The toggle gates LOCAL
 * COMPUTE BEING SPENT; these spend none.
 * ⚠ **`set_agent_mode` IS THE EXCEPTION AND IT ARRIVES ON THIS SAME ROUTE**
 * (2026-09-01, the agent-efficiency wave). It IS behind the toggle
 * (`main/launch-directive-wire.js › KINDS_NEEDING_LAUNCH_CONSENT` lists it beside
 * `launch`), because a POSTURE is the one verb of the three that can cause LOCAL
 * COMPUTE TO BE SPENT: `bypass` on Axis A pre-approves work tools on hardware the
 * operator pays for. **Do not read the three non-launch kinds as one class** —
 * that reading hands an un-armed machine the widest half of the launch lane
 * without the launch.
 * ⚠ **THE SERVER NEITHER ENFORCES NOR OBSERVES ANY OF THAT** — the toggle is an
 * `electron-store` boolean no server can see. `main/launch-directives.js ›
 * handle` is where the distinction lives, and this route is stating the ruling,
 * not implementing it.
 *
 * ⚠ **`minRole` STAYS AT THE VIEWER FLOOR BECAUSE THE CHANNEL FENCE IS THE REAL
 * ONE**, exactly as on the launch create: the service requires a MEMBERSHIP ROW,
 * not merely readability. A `channel` is REQUIRED on this op even though the
 * agent id alone would address the target — without it this is a bare "end agent
 * `abcdefgh`" primitive with no room the caller had to be in first.
 *
 * ⚠ A DIRECTIVE IS NOT A MESSAGE and never touches `channel_messages` —
 * INVARIANTS §5, the loop brake and transcript purity. Ending an agent is not
 * something the other member's transcript should record.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, AgentDirectiveCreateSchema);
    const ctx = buildChannelContext(auth);
    const result = await createAgentDirective(
      ctx,
      // ⚠ RE-SPREAD PER ARM RATHER THAN PASSED THROUGH, so the discriminated
      // union survives into the service signature. A single `input` pass would
      // widen to "an object that might have a name", which is the shape the
      // schema exists to refuse.
      input.kind === "rename"
        ? {
            kind: "rename",
            channel: input.channel,
            agentId: input.agentId,
            name: input.name,
          }
        : input.kind === "set_agent_mode"
          ? {
              // ⚠ THE POSTURE ARM (2026-09-01). Both axes optional and AT LEAST
              // ONE required — the schema refuses the empty ask before a row
              // exists, and the column CHECK refuses it again at rest.
              // ⚠ **A REQUEST, NEVER A GRANT**: the machine CLAMPS each axis to
              // the operator's own stored channel posture and never widens.
              // ⚠ THIS IS THE ONE NON-LAUNCH KIND STILL BEHIND THAT MACHINE'S
              // LAUNCH-CONSENT TOGGLE — see the ruling above, which covers `end`
              // and `rename` and deliberately does NOT cover this one.
              kind: "set_agent_mode",
              channel: input.channel,
              agentId: input.agentId,
              tools: input.tools,
              messages: input.messages,
            }
          : { kind: "end", channel: input.channel, agentId: input.agentId }
    );
    // ⚠ 200 WITH `offline: true`, NOT AN ERROR STATUS — the launch create's rule
    // verbatim. Nothing failed: the operator's machine is not listening and NO
    // ROW WAS CREATED. A 4xx here would render the most ordinary outcome there is
    // (a closed laptop) as a fault.
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost);
