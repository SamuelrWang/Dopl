import "server-only";
import type { WalletKind } from "../credits";

/**
 * THE CREDIT ATTRIBUTION LEDGER'S CONTRACT — what one row means, and which of
 * its dimensions the counter's key cannot carry.
 *
 * 🔒 **THERE IS NO WRITER IN THIS FILE ANY MORE (2026-09-13, Samuel: "the
 * histogram must equal the wallet, always"; F-693).** `recordCreditUsageEvent` is
 * DELETED, not deprecated: the row is written by the WALLET RPCs themselves
 * (`supabase/migrations/20261004120000_credit_consume_with_ledger.sql`), inside
 * the same transaction as the counter, so the two cannot disagree. What survives
 * here is the row's MEANING, which every reader still needs and which the RPC's
 * positional arguments do not explain.
 *
 * ⚠ **THE SUPERSEDED VERSION WAS FIRE-AND-FORGET, AND THE COST IT STATED CAME
 * DUE.** Its header said the ledger "MAY UNDER-COUNT" and that every reader must
 * treat `SUM(amount)` as a FLOOR. Measured 2026-09-13: Samuel's personal wallet
 * counter read `used = 8` over FIVE ledger rows, because for the minutes between
 * the server naming `channel_id` and `20261003120000` being applied every insert
 * answered `42703` and was `console.warn`ed while the counter had already moved.
 * A floor is not good enough for a figure printed beside the counter on one card.
 *
 * 🔒 **IT IS STILL NOT THE BILLING COUNTER AND MAY NOT BEHAVE LIKE ONE.** The
 * WALLET COUNTERS (`credit-wallets.ts` → `user_credit_usage`,
 * `workspace_member_credit_usage`) remain the sole authority on whether a call is
 * allowed and how much of the allowance is gone; nothing reads
 * `credit_usage_events` to decide a charge. `20260811130000_mcp_credits.sql`'s
 * header rules out building ENFORCEMENT on this table and that is unchanged —
 * what changed is only that the table can no longer fall BEHIND the counter.
 * ⚠ Whether the two AGREE for rows written before the fix is a measurement, not
 * an assumption: `credits-audit.ts › walletMatchesLedger` is how it is taken, and
 * `GET /api/billing/status › credits.ledgerDrift` is where the answer is
 * published.
 */

/**
 * One burn, as the ledger records it.
 *
 * 🔒 **THE PAYER IS A PERSON, NOT A WORKSPACE (2026-09-07, Samuel's per-seat +
 * personal-wallet ruling), AND THAT MOVED WHAT `workspaceId` MEANS.** It used to
 * be the payer — for a home burn, the owner's separate standard workspace. There
 * is no such workspace on the credit path any more, so the column holds the
 * ADDRESSED CONTAINER and `payerUserId` carries the payer. The row's dimensions
 * are: where (`workspaceId` / `originWorkspaceId`), who called (`userId`), which
 * channel was billed (`channelId`), whose wallet (`payerUserId`), which wallet
 * (`wallet`).
 *
 * ⚠ **THIS INTERFACE IS THE ROW, NOT A CALL SIGNATURE.** The RPC takes the four
 * fields it cannot derive as {@link CreditLedgerAttribution}; `wallet`,
 * `payerUserId`, `amount` and `periodStart` are already the consume arguments,
 * and the RPC writes the wallet label as a LITERAL so a caller cannot mislabel
 * which counter it just moved.
 */
export interface CreditUsageEvent {
  /**
   * THE ADDRESSED CONTAINER — the workspace row the caller was authorized into.
   * ⚠ Equal to `originWorkspaceId` on every row this build writes; both are
   * kept because the column is `NOT NULL` with an FK (so it cannot hold a
   * person) and `/home`'s rails read the origin. ⚠ It is NOT the payer, and it is
   * NOT the charged container either — under rule B a seat burn's charged
   * workspace is the counter's key and appears on this row nowhere.
   */
  workspaceId: string;
  /**
   * WHERE the call was addressed: the addressed workspace, which for a home
   * channel is the `kind='link'` CONTAINER. ⚠ NOT the "by channel" dimension —
   * that is `channelId`, and reading it off this column is the defect rule B
   * fixed.
   */
  originWorkspaceId: string | null;
  /** Who burned it. `null` only when the caller could not be identified. */
  userId: string | null;
  /**
   * 🔒 **THE CALLING CHANNEL — RULE B's ATTRIBUTION (Samuel, 2026-09-13: "the
   * wallet needs to match the histogram; that's the whole point"), AND THE ONLY
   * DIMENSION ON THIS ROW THAT IS NOT DERIVABLE FROM ANOTHER.** The channel whose
   * container was CHARGED, from the caller's session key
   * (`credits-service.ts › resolveBillingTarget`).
   *
   * ⚠ **`null` MEANS "NO CALLING CHANNEL" AND READS AS "Desktop agent"** — a
   * Claude Desktop or Claude Code MCP connection, an app click, an older desktop
   * build, and EVERY row written before
   * `20261003120000_credit_events_channel.sql`. Legacy rows cannot be
   * backfilled: the session that made the call is gone, and the origin container
   * does not answer the question (under rule B the charged channel and the
   * addressed container differ whenever an agent reaches across containers).
   *
   * ⚠ **NOT `originWorkspaceId` UNDER A DIFFERENT NAME.** That column is WHERE
   * the call was addressed; this is WHOSE CHANNEL was billed for it. They agreed
   * on every row written before rule B, which is exactly why the by-channel
   * breakdown used to be read off the wrong one.
   */
  channelId: string | null;
  /** WHICH COUNTER MOVED — `credit-wallets.ts`'s two tables. */
  wallet: WalletKind;
  /**
   * THE PAYER — whose wallet moved. The container OWNER on a personal burn
   * (which is not the caller when a peer made the call), the caller themself on
   * a seat burn. ⚠ This is the column "who spent my credits" reads; `userId`
   * answers a different question and the two differ exactly on the guest path.
   */
  payerUserId: string | null;
  amount: number;
  /** The period key the counter used — stamped, never derived from `created_at`
   *  (a paid workspace's period is anchored to its subscription date). */
  periodStart: string;
}

/**
 * The ledger dimensions a consume RPC has to be TOLD, because they are facts
 * about the CALLER's request rather than about the counter it is moving.
 *
 * ⚠ **ONE OBJECT, APPENDED TO BOTH CONSUME SIGNATURES, RATHER THAN THREE LOOSE
 * ARGUMENTS.** The wallet RPCs already take five positional arguments; three more
 * UUID-shaped ones in a row is how a caller comes to pass the payer where the
 * caller belongs, which is precisely the pair the ledger exists to keep apart.
 *
 * ⚠ **`originWorkspaceId` IS NOT OPTIONAL.** `credit_usage_events.workspace_id`
 * is `NOT NULL`, so an absent value is a `23502` that now REFUSES THE SPEND
 * rather than dropping a row — which is the intended direction, and a reason to
 * pass the addressed container explicitly at every call site.
 */
export interface CreditLedgerAttribution {
  /** The ADDRESSED container, written to `workspace_id` AND
   *  `origin_workspace_id`. */
  originWorkspaceId: string;
  /** WHO called — `credit_usage_events.user_id`. Differs from the payer exactly
   *  on the guest path. */
  callerUserId: string | null;
  /** Rule B's calling channel, or `null` for "Desktop agent". */
  channelId: string | null;
}
