import "server-only";
import type { WalletKind } from "../credits";

/**
 * The credit attribution ledger's contract — what one row means, and which of its
 * dimensions the counter's key cannot carry.
 *
 * F-693 (2026-09-13): there is no writer in this file. The row is written by the
 * wallet RPCs themselves, inside the same transaction as the counter, so the two
 * cannot disagree; what survives here is the row's meaning, which the RPC's
 * positional arguments do not explain.
 *
 * It is still not the billing counter: the wallet counters (`credit-wallets.ts`)
 * remain the sole authority on whether a call is allowed, and nothing reads
 * `credit_usage_events` to decide a charge. Whether the two agree for rows written
 * before the fix is a measurement — `credits-audit.ts › walletMatchesLedger` takes
 * it, `GET /api/billing/status › credits.ledgerDrift` publishes it.
 */

/**
 * One burn, as the ledger records it.
 *
 * 2026-09-07: the payer is a person, not a workspace, so `workspaceId` holds the
 * ADDRESSED container and `payerUserId` carries the payer. Dimensions: where
 * (`workspaceId` / `originWorkspaceId`), who called (`userId`), which channel was
 * billed (`channelId`), whose wallet (`payerUserId`), which wallet (`wallet`).
 *
 * This interface is the row, not a call signature: the RPC takes only the fields it
 * cannot derive, as {@link CreditLedgerAttribution}, and writes the wallet label as
 * a literal so a caller cannot mislabel which counter it moved.
 */
export interface CreditUsageEvent {
  /**
   * The addressed container — the workspace row the caller was authorized into.
   * Equal to `originWorkspaceId` on every row this build writes; both are kept
   * because the column is `NOT NULL` with an FK and `/home`'s rails read the origin.
   * Neither the payer nor the charged container: under rule B a seat burn's charged
   * workspace is the counter's key and appears on this row nowhere.
   */
  workspaceId: string;
  /**
   * Where the call was addressed — for a home channel, the `kind='link'` container.
   * Not the "by channel" dimension; that is `channelId`, and reading it off this
   * column is the defect rule B fixed.
   */
  originWorkspaceId: string | null;
  /** Who burned it. `null` only when the caller could not be identified. */
  userId: string | null;
  /**
   * Rule B's attribution (2026-09-13) and the only dimension on this row that is
   * not derivable from another: the channel whose container was CHARGED, from the
   * caller's session key (`credits-service.ts › resolveBillingTarget`).
   *
   * `null` means "no calling channel" and reads as "Desktop agent" — external MCP
   * connections, app clicks, older desktop builds, and every row written before
   * `20261003120000_credit_events_channel.sql`. Legacy rows cannot be backfilled:
   * the session is gone and the origin container does not answer the question.
   *
   * Not `originWorkspaceId` under another name — that column is WHERE the call was
   * addressed, this is WHOSE CHANNEL was billed for it.
   */
  channelId: string | null;
  /** Which counter moved — `credit-wallets.ts`'s two tables. */
  wallet: WalletKind;
  /**
   * The payer — whose wallet moved: the container owner on a personal burn, the
   * caller themself on a seat burn. This is the column "who spent my credits"
   * reads; `userId` answers a different question, and the two differ exactly on the
   * guest path.
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
 * One object rather than three loose arguments: the wallet RPCs already take five
 * positional arguments, and three more UUID-shaped ones is how a caller comes to
 * pass the payer where the caller belongs.
 *
 * `originWorkspaceId` is not optional — `credit_usage_events.workspace_id` is
 * `NOT NULL`, so an absent value is a `23502` that refuses the spend rather than
 * dropping a row.
 */
export interface CreditLedgerAttribution {
  /** The addressed container, written to `workspace_id` and
   *  `origin_workspace_id`. */
  originWorkspaceId: string;
  /** Who called — `credit_usage_events.user_id`. Differs from the payer exactly
   *  on the guest path. */
  callerUserId: string | null;
  /** Rule B's calling channel, or `null` for "Desktop agent". */
  channelId: string | null;
}
