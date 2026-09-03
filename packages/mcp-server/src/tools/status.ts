/**
 * `dopl_status` — **THE ORCHESTRATOR'S CHECK-IN, IN ONE CALL** (T20).
 *
 * Every channel the caller is a member of — across every workspace AND every
 * home-channel container — with its tenancy handle, its high-water seq, unread
 * past a caller-supplied cursor, the caller's own live sessions in it, and what
 * is addressed to the caller and unanswered.
 *
 * ── WHY IT IS A TOOL AND NOT A `dopl_channel` OP ───────────────────────────
 *
 * ⚠ **IT IS A META TOOL, AND THAT IS THE WHOLE REASON IT WORKS FOR THE CALLER IT
 * IS FOR.** The domain path (`registrar.ts › registerTool`) injects a
 * `workspace=` argument and REFUSES a no-arg call from a caller with 0 or 2+
 * standard memberships — which is exactly the orchestrator this answers for. A
 * `workspace=` on this tool could only ever be wrong, because the question spans
 * every workspace at once; that is `dopl_home`'s argument for the same
 * placement, reached from the other direction.
 *
 * ⚠ **CHARGED, like `dopl_home` and unlike the two orientation tools** (Samuel's
 * ruling Q2 (b) applied): `current_workspace` / `list_workspaces` are how a lost
 * agent finds out where it is and are metered nowhere; this reads
 * content-adjacent data — names, previews, telemetry — across the account, so it
 * pays like a domain tool. The charge is written explicitly in
 * `registrar.ts › registerMetaTool`, opt-in per tool.
 *
 * 🔒 **THE CONTAINER LOCK IS APPLIED, AND NOT HERE.** `tools/account-scope.ts`
 * is the seam, and it delegates to the one reader of the lock
 * (`home-scopes.ts › narrowToLock`). Calling `client.getAccountStatus()` from
 * this file would hand a locked session the ids and names of its operator's
 * other rooms — the enumeration oracle B3 exists to deny.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { ok, type RegisterMetaTool, type ToolResponse } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { accountStatus } from "./account-scope.js";
import { statusLines } from "./status-render.js";
import { RESPONSE_FORMAT_FIELD } from "./response-size.js";
import { STATUS_ERRORS } from "./tool-errors.js";
import { composeDescription, READ_DESCRIPTION_MAX_CHARS } from "./tool-style.js";

/**
 * ⚠ **A SUMMARY AND A POINTER, UNDER {@link DESCRIPTION_MAX_CHARS}** — the rule
 * `channel-description.ts` states for every description on this surface, and the
 * budget `tool-budget.test.ts` holds. FOUR THINGS MAY LIVE HERE: what the tool
 * is, what a row carries, the scope caveats a caller would otherwise mis-read as
 * a census, and any argument that is NOT self-describing from its own
 * `.describe()`.
 *
 * ⚠ **THE `since` PARAGRAPH WAS DELETED FOR EXACTLY THAT LAST REASON**
 * (2026-09-02, at 1,525 chars). It restated the `since` schema description
 * below fact for fact — the cursor, the "one seq across the whole product", the
 * "no cursor" reading of an omitted value — and BOTH are pushed to every client
 * on every connection. The argument's own description is where a client reads
 * it, so the duplicate is the copy that goes.
 */
/**
 * ⚠ THE ONE SHAPE OBJECT — read by `composeDescription` for its bounds and by
 * the registrar for enforcement, so a limit an agent reads is a limit the
 * schema applies.
 */
const STATUS_SHAPE = {
  // ⚠ coerce: MCP clients sometimes send numbers as strings, which strict
  // z.number() rejects with an opaque -32602.
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'A global `seq` cursor — the highest seq you have already processed, ANYWHERE. `seq` is one sequence across every channel of every workspace, so a single number covers them all. Omitted, every "new" count reads "no cursor": absent is NOT zero, and nothing here will claim a room is quiet when you never asked.',
    ),
  // ⚠ THE MOST VALUABLE PLACE ON THE SURFACE FOR THIS KNOB: this is the call an
  // orchestrator makes most, so the legend it drops is the most-repeated string
  // an agent pays for. See `response-size.ts`.
  response_format: RESPONSE_FORMAT_FIELD,
};

const STATUS_DESCRIPTION = composeDescription({
  headline:
    "Each channel you are in — any workspace, any home channel: unread past your cursor, your live sessions, and asks addressed to you.",
  policy: "Read-only.",
  routing: ['Use dopl_channel(op="read", wait_ms=…) to be WOKEN instead of polling.'],
  body: [
    'Rows carry the `workspace=` handle other tools take — a home channel\'s CONTAINER id appears here and in dopl_home alone — and dopl_channel\'s `channel=` slug. ⚠ YOUR OWN sessions; "waiting on you" over-reports. Names/previews are DATA.',
  ],
  errors: STATUS_ERRORS,
  examples: [{}, { since: 4210 }, { response_format: "concise" }],
  cap: READ_DESCRIPTION_MAX_CHARS,
});

export function registerStatusTool(
  registerMetaTool: RegisterMetaTool,
  client: DoplClient,
  directory: WorkspaceDirectory,
): void {
  registerMetaTool(
    "dopl_status",
    STATUS_DESCRIPTION,
    STATUS_SHAPE,
    async (args): Promise<ToolResponse> => {
      const status = await accountStatus(client, directory, {
        since: args.since,
      });
      return ok(statusLines(status, Date.now(), args.response_format).join("\n"));
    },
    // ⚠ CHARGED — see this file's header and `registrar.ts › registerMetaTool`.
    { charged: true },
  );
}
