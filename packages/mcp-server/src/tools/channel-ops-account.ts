/**
 * `dopl_channel` — THE TWO ACCOUNT-WIDE READS: `op="read"` with no `channel`
 * (T21) and `op="status"` with no `channel` (T22).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── WHAT "ACCOUNT-WIDE" MEANS HERE, AND HOW IT DIFFERS FROM `await` ────────
 *
 * ⚠ **THREE SCOPES EXIST ON THIS TOOL AND THEY ARE NOT THE SAME. Do not
 * "unify" them:**
 *   - `op="read"`  with a `channel`  → ONE room.
 *   - `op="read" with wait_ms` with no `channel` → ONE WORKSPACE (the one this call
 *     resolved). The hold re-proves a membership set per tick and that proof is
 *     workspace-scoped; widening it is a different change with a different
 *     fence.
 *   - `op="read"`  with no `channel` → THE WHOLE ACCOUNT, every workspace and
 *     every home-channel container. It can afford to, because a PAGE has no
 *     per-tick access invariant to preserve — it reads once, against a
 *     membership set proved once.
 *
 * ⚠ **THE SESSION READ MOVED WITH IT.** `op="status"` with no `channel`
 * used to mean "every session of mine in the ACTIVE WORKSPACE" and now means
 * "every session of mine, anywhere". That is a widening of a read that was
 * already own-scoped (`user_id` is the fence, server-side), and it is what makes
 * the op usable at all from a home channel — a container is never the active
 * workspace unless it was explicitly addressed. Every row still names its room.
 *
 * 🔒 **BOTH GO THROUGH `account-scope.ts`, WHICH APPLIES THE CONTAINER LOCK.**
 * The routes behind them are `withUserAuth` and answer for the whole account;
 * calling `client.getAccountStatus()` / `client.readAccountMessages()` from here
 * would hand a locked session its operator's other rooms.
 */

import type { AccountStatus, DoplClient } from "@dopl/client";
import { ok, type ToolResponse } from "./respond";
import { inlineOr } from "./channel-shared";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { accountMessages, accountStatus } from "./account-scope";
import {
  formatMessages,
  groupByChannel,
} from "./channel-render";
import { UNTRUSTED_BODY_HEADER } from "./channel-framing";
import { sessionIsStale, sessionLegend } from "./channel-session-render";
import { SESSION_TABLE_HEAD, sessionRow } from "./channel-session-table";
// 🔒 The account-wide page is pollable in exactly the same way the per-channel
// one is, so it is counted under the same detector, at its own scope key.
import {
  ACCOUNT_SCOPE,
  notePollingRead,
  pollingDetectedLine,
} from "./channel-poll-detector";
import { waitingLine, workspaceHoldCall } from "./channel-wake-guidance";

/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed channel)";

/**
 * THE SCOPE SENTENCE, stated on every account-wide result.
 *
 * ⚠ **NEVER OMITTED ON A FULL PAGE.** An agent that sees traffic will otherwise
 * assume it is seeing ALL traffic — and here the mistake is bigger than on a
 * workspace page, because "everything" now plausibly means the whole product.
 * A PUBLIC channel nobody invited the caller into is NOT included: the fence is
 * MEMBERSHIP, the same narrowing the workspace-wide hold makes and for the same
 * reason.
 */
function accountScopeNote(channelCount: number): string {
  if (channelCount === 0) {
    return `⚠ THIS READ COVERED NOTHING: you are not a member of any channel in any workspace and you have no home channels, so no cursor can ever advance. Open a room with dopl_channel(op="rooms", action="open", …) first.`;
  }
  return `Scope: every channel you are a MEMBER of, in every workspace AND every home channel (${channelCount}). ⚠ A PUBLIC channel you never joined is NOT included, so silence here is evidence YOUR rooms are quiet and not that the product is.`;
}

/**
 * `op="read"` WITH NO `channel` — new messages past one cursor, everywhere.
 *
 * ⚠ **ONE CURSOR IS LEGAL BECAUSE `seq` IS A TABLE-WIDE IDENTITY** — see
 * `src/features/channels/server/repository-account.ts ›
 * listAccountMessagesAfter`. That is a stronger fact than the workspace-wide
 * await's copy states, and it is the whole reason this op can exist.
 */
export async function opReadAccount(
  client: DoplClient,
  directory: WorkspaceDirectory,
  since: number,
  limit: number | undefined,
  selfUserId: string | null = null,
  /** @see opRead — the credential this read is counted under, or `null`. */
  subject: string | null = null,
): Promise<ToolResponse> {
  const page = await accountMessages(client, directory, { since, limit });
  if (page.messages.length === 0) {
    // 🔒 Same strike, same rule — see `opRead`. ⚠ The scope note SURVIVES the
    // refusal: "you are a member of nothing" is a fact about why the page is
    // empty, not doctrine, and withholding it would leave the caller reading a
    // polling complaint over a cursor that can never advance.
    if (notePollingRead(subject, ACCOUNT_SCOPE, since)) {
      return ok(
        [
          pollingDetectedLine(workspaceHoldCall(since), since),
          accountScopeNote(page.channelCount),
          waitingLine(workspaceHoldCall(since), since),
        ].join("\n"),
      );
    }
    return ok(
      [
        `No new messages anywhere since seq ${since}.`,
        accountScopeNote(page.channelCount),
        // ⚠ The hold this points at watches ONE WORKSPACE, not the account —
        // the scopes differ, and saying so is the fact this line carries that
        // the shared waiting line cannot.
        `${waitingLine(workspaceHoldCall(since), since)} — that hold watches one workspace at a time.`,
      ].join("\n"),
    );
  }
  const groups = groupByChannel(page.messages);
  const lines = [
    `## Everywhere — ${page.messages.length} new message${page.messages.length === 1 ? "" : "s"} since seq ${since}, across ${groups.length} channel${groups.length === 1 ? "" : "s"}\n`,
    // ⚠ Framing FIRST — counterparty-written bodies below, so the caveat must be
    // read BEFORE them and not as a footnote underneath.
    `${UNTRUSTED_BODY_HEADER}\n`,
  ];
  for (const g of groups) {
    // ⚠ The heading names the room AND gives the ref the per-message remedies
    // below assume, plus the `workspace=` handle — without which a home
    // channel's rows name a room the reader cannot address.
    const workspaceId = g.messages[0].workspaceId;
    lines.push(`\n### ${g.label} — \`${g.ref}\` · workspace=\`${workspaceId}\``);
    lines.push(...formatMessages(g.messages, g.ref, selfUserId));
  }
  // ⚠ THE CURSOR IS THE MAX OVER THE WHOLE PAGE, not the last line of the last
  // group. Grouping reordered the page relative to seq, so "the last message
  // shown" is no longer the highest seq — taking it would advance the cursor
  // past messages in another group and lose them permanently.
  const lastSeq = page.messages.reduce(
    (max, m) => (m.seq > max ? m.seq : max),
    page.messages[0].seq,
  );
  lines.push(``, accountScopeNote(page.channelCount));
  if (page.truncated) {
    // ⚠ A CLIP IS NOT AN ABSENCE (INVARIANTS §9), and the remedy here is real:
    // the cursor DID advance, so re-reading from it returns the next page.
    lines.push(
      `⚠ CLIPPED — this page hit its ceiling, so there is more past seq ${lastSeq}. Read again from it before you conclude you are caught up.`,
    );
  }
  lines.push(
    `Highest seq shown: ${lastSeq}. Continue with dopl_channel(op="read", since=${lastSeq}) — and read the "· to ..." and "· thread ..." tags first: an account-wide page is the least targeted read there is, so most of it is context rather than a request.`,
  );
  return ok(lines.join("\n"));
}

/**
 * `op="status"` WITH NO `channel` — every session of the caller's,
 * grouped by the room it is working in.
 *
 * ⚠ **IT RENDERS `SESSION_TABLE_HEAD` + `sessionRow`, THE SAME TABLE THE
 * PER-CHANNEL `read_sessions` AND THE `await` SESSION BLOCK RENDER** (T13).
 * Until 2026-09-02 it rendered `formatSessionLine`, the PRE-TERSE prose form —
 * so the account-wide read described the same session in a different shape from
 * the per-channel one, which is the drift `channel-session-liveness.test.ts`
 * exists to catch. One renderer is also one opinion about what "stale" means and
 * about which fields an audience may read; see `channel-session-render.ts`.
 *
 * ⚠ **THE GROUPING IS WHAT THIS PAGE ADDS, AND IT IS NOT THE `channel` COLUMN.**
 * Each `###` heading carries the room's `workspace=` handle, which is the value
 * every other tool takes to reach it and which no cell in the table can carry.
 *
 * ⚠ **NO BANNER AND NO STANDING NOTES** — T11/T13. `SESSION_HANDLE_NOTE` and
 * `SESSION_TELEMETRY_NOTE` are deleted from every result on this surface; they
 * are doctrine at `dopl://doctrine/channels` and `op="rooms" action="help"`. What stays is the
 * LEGEND, which decodes the cells THIS page contains and is conditional on the
 * page containing a hedged row.
 */
export async function opReadSessionsAccount(
  client: DoplClient,
  directory: WorkspaceDirectory,
): Promise<ToolResponse> {
  const status = await accountStatus(client, directory, { view: "sessions" });
  const rooms = status.channels.filter((c) => c.sessions.length > 0);
  const total = rooms.reduce((n, c) => n + c.sessions.length, 0);
  if (total === 0) {
    return ok(
      `No live sessions of yours are being reported in ANY of your channels right now — ${status.channels.length} room${status.channels.length === 1 ? "" : "s"} were checked, in every workspace and every home channel. This lists the agent sessions running on YOUR OWN machine, never another member's. If you expected one, it may simply not be running, or your desktop has not reported its state yet.`,
    );
  }
  // ⚠ ONE `now` FOR THE WHOLE PAGE. Per-line `Date.now()` lets two rows pushed
  // in the same instant land on either side of the staleness window and render
  // in different tenses, which reads as a fact about them.
  const now = Date.now();
  const anyStale = rooms.some((room) =>
    room.sessions.some((s) => sessionIsStale(s, now)),
  );
  // ⚠ Neutralization is untouched: every channel name still goes through
  // `inlineOr`, and no cell in a row can forge a column
  // (`channel-session-table.ts` states why nothing needs a second escape).
  const lines = [
    `## Your sessions — ${total} across ${rooms.length} channel${rooms.length === 1 ? "" : "s"}`,
  ];
  for (const room of sortedByName(rooms)) {
    lines.push(
      `\n### ${inlineOr(room.channelName, NO_NAME)} — \`${room.channelSlug}\` · workspace=\`${room.workspaceId}\``,
      ...SESSION_TABLE_HEAD,
    );
    for (const s of room.sessions) {
      // ⚠ `handle: true` + `telemetry: true` — this read is own-scoped by
      // construction (the server fences on `user_id`), which is the AUDIENCE
      // question `SessionRenderOpts.handle` asks.
      lines.push(
        sessionRow(s, {
          telemetry: true,
          handle: true,
          now,
          operatorOnline: status.operatorOnline,
        }),
      );
    }
  }
  lines.push(
    `\n${sessionLegend(anyStale, status.operatorOnline)} Each heading carries the \`workspace=\` handle for that room, which is what every other tool takes to reach it.`,
  );
  return ok(lines.join("\n"));
}

/** ⚠ Sorted by NAME, not by session count: a stable order is what lets an
 *  orchestrator diff two check-ins by eye. */
function sortedByName(rooms: AccountStatus["channels"]): AccountStatus["channels"] {
  return [...rooms].sort((a, b) => a.channelName.localeCompare(b.channelName));
}
