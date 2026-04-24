/**
 * Master kill-switch for the "first 100 users get a free month of Pro" promo.
 *
 * When `false` (current state — beta period):
 *   • Landing-page hero badge is hidden
 *   • Sign-in does NOT grant the 500-credit bonus
 *   • Sign-in does NOT show the congrats modal
 *   • The migration, the RPC, and the /api/early-supporter/count endpoint
 *     all stay in place — they're just unused.
 *
 * Flip to `true` for the Product Hunt launch and redeploy. Nothing else
 * needs to change. To roll back, flip to `false` again — already-granted
 * users keep their bonus credits forever.
 */
export const EARLY_SUPPORTER_ENABLED = false;
