# Credit model v2 — personal wallets + per-seat workspace allocations

**Status:** **BUILT** (2026-09-08, branch `feat/credit-model-v2` — ⚠ **UNMERGED, and migration
`20260930120000_credit_wallets.sql` is WRITTEN AND NOT APPLIED**; deploy state is a measurement, so
re-derive with `supabase migration list` joined ON THE NAME, never on the filename prefix). Samuel's
ruling, verbatim intent, then the contract every slice built against. **The code now outranks this
document** (CLAUDE.md's precedence: code > INVARIANTS > ENGINEERING > a spec) — read
`src/features/billing/credits.ts` and `server/credits-service.ts` for what is true, this file for
what was decided and why. Current state lives in `docs/INVARIANTS.md` §10 and §4A; the rationale is
the `2026-09-07 — Credit model v2` stratum in `docs/ENGINEERING.md`. Deviations from the contract
below are listed in §10, not silently absorbed.

## 0. Samuel's ruling (2026-09-07, paraphrase kept close)

> In the **home space**, an individual user is charged credits for what **their own agent** spent
> in MCP calls. **Workspaces bill separately**, like Slack: **one person pays** for the whole
> workspace, **by seats**. Creating a workspace is **free**, members are **unlimited**, but **each
> member gets a fixed, non-pooled credit allocation**:
> - **Free:** 100 credits per member.
> - **Paid:** 5,000 credits per member, at **$8 per seat**.

### Assumptions filled in by the Desktop Agent (flag to Samuel; all tunable in `credits.ts`)

| # | Assumption | Why |
|---|---|---|
| A1 | Allocations reset every period, no rollover. Personal wallet = UTC calendar month. Workspace seats = the workspace's existing period rule (paid → Stripe anchor, free → calendar month). | Matches the self-rolling counter design already in the tree; no reset cron. |
| A2 | Exhausted allocation = hard stop with a clear MCP refusal. No overage, no borrowing from another member, no pooling. | "fixed … not pooled" |
| A3 | Seat = active member (`workspace_members.status='active'`), the count Stripe already syncs. Departure frees the seat. | Existing seat sync + Samuel's departure=removal ruling. |
| A4 | Tier is workspace-wide: the payer flips the whole workspace Free→Team. No mixed tiers. | "one person pays for the entire workspace" |
| A5 | **Personal wallet free allowance = 500/month** (the status-quo free number; Samuel gave no personal figure). No personal paid tier this wave — `PERSONAL_MONTHLY_CREDITS` is one constant and a personal paid plan is a follow-up ruling. | Do not cut existing users' free allowance overnight; do not invent a price. |
| A6 | Solo/"Pro" ($5.99 flat single-member workspace plan) is **retired from sale**. Live `solo` rows keep working as a legacy paid workspace (per-member allowance = the paid figure) until they cancel or switch to Team. | Two workspace tiers only: Free and Team. |
| A7 | Team seat price displays **$8.00**. ⚠ Stripe still holds the $7.99 price under `STRIPE_PRO_SEAT_PRICE_ID`; Samuel creates the $8 price and flips the env. Code does not touch Stripe prices. | Deploy state is a measurement, not a claim. |
| A8 | Free × unlimited members is an abuse vector (100 × N puppets). Allocation is per ACTIVE member only; anything stronger is Samuel's call. | Flagged, not solved. |

## 1. Vocabulary

- **Wallet** — the counter a burn lands on. Two kinds:
  - `personal` — one per user. Pays for every MCP call made **in that user's home space**: their
    `kind='personal'` container and every `kind='link'` container they OWN (a home channel). A
    guest's/peer's calls inside a link container land on the **owner's** personal wallet (Samuel,
    2026-08-26: "charge MCP calls from a guest to the user"; unchanged, only the wallet moved).
  - `seat` — one per (standard workspace, active member). Pays for calls the member makes **in that
    standard workspace**. Limit = the workspace's entitled plan's per-member allowance.
- **Payer** — whose wallet moved. Personal: the container owner. Seat: the caller themself (the
  workspace owner pays Stripe for the seat; the member spends the seat's allocation).
- **Period key** — `period_start` stamped on the counter row; the counter self-rolls.

## 2. Numbers — `src/features/billing/credits.ts` (THE retune spot)

```ts
export const CREDITS_PER_MCP_CALL = 1;                       // unchanged
export type WalletKind = "personal" | "seat";
/** Per-MEMBER monthly allowance inside a standard workspace, by ENTITLED plan.
 *  `solo` is legacy-paid and gets the paid figure. */
export const SEAT_MONTHLY_CREDITS: Record<PlanId, number> = { free: 100, solo: 5_000, team: 5_000 };
/** Personal wallet monthly allowance (home space). One tier this wave. */
export const PERSONAL_MONTHLY_CREDITS = 500;
export function seatCreditsForPlan(plan: PlanId): number;    // replaces monthlyCreditsForPlan
export function personalCreditPeriod(now?: Date): CreditPeriod; // UTC calendar month
export function resolveCreditPeriod(anchor, entitledPlan, now?): CreditPeriod; // unchanged
```

`MONTHLY_MCP_CREDITS` and `monthlyCreditsForPlan` are **deleted**, not aliased — every importer
moves (grep list in §9). Prices: `TEAM_SEAT_PRICE = 8` (display), `SOLO_PRICE` stays for the
legacy row's label only.

## 3. Attribution rule (the one table every path implements)

| Addressed container `kind` | Wallet | Payer | Limit | Period |
|---|---|---|---|---|
| `standard` | `seat` | caller (`ctx.userId`) | `SEAT_MONTHLY_CREDITS[entitledPlanFor(billing, memberCount)]` | `resolveCreditPeriod(billing anchor, verdict)` |
| `personal` | `personal` | container owner (= the caller; it has one member) | `PERSONAL_MONTHLY_CREDITS` | `personalCreditPeriod()` |
| `link` | `personal` | container OWNER (`findActiveOwnerUserId`) — whoever called | `PERSONAL_MONTHLY_CREDITS` | `personalCreditPeriod()` |
| container with no active owner | none | — | unmetered, `degraded: true`, logged (existing posture) | — |

`findSoleOwnedStandardWorkspace` is **no longer on the credit path** (its two remaining refusal
reasons `container-owner-has-no-billing-workspace` / `…-ambiguous-billing-workspace` are deleted
with it; the webhook grandfather path still uses the function). Every user has exactly one
personal wallet, so there is nothing left to be ambiguous about.

Round-trip budget (pinned by mock call counts): seat path = billing row + member count
(concurrent) + RPC = **3**; personal path = owner lookup + RPC = **2** (for `kind='personal'` the
owner IS the caller — skip the lookup: **1**).

## 4. Schema — `supabase/migrations/20260930120000_credit_wallets.sql` (WRITTEN, NOT APPLIED)

Header must carry: written-not-applied, `supabase migration list` re-derive note, apply order
(after every pending file, filename order), full rollback block. Byte-exact apply by Samuel; **no
`db push`, no MCP `apply_migration` from any agent.**

```sql
-- 1. personal wallet counter
CREATE TABLE IF NOT EXISTS public.user_credit_usage (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);
-- RLS on; REVOKE INSERT/UPDATE/DELETE from authenticated, anon; SELECT policy: user_id = auth.uid()

-- 2. seat counter
CREATE TABLE IF NOT EXISTS public.workspace_member_credit_usage (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, period_start)
);
-- RLS on; REVOKE writes; SELECT policy: user_id = auth.uid() OR is_current_workspace_member(workspace_id, 'admin'::text)

-- 3. RPCs — SAME single-statement upsert-CAS as consume_workspace_credits (copy its body shape,
--    its IF p_amount <= p_limit guard on the insert path, table-qualified columns, SECURITY
--    DEFINER, SET search_path = public, REVOKE ALL FROM PUBLIC/anon/authenticated, GRANT service_role)
consume_user_credits(p_user_id UUID, p_period_start TIMESTAMPTZ, p_amount INT, p_limit INT)
  RETURNS TABLE (allowed BOOLEAN, used INT)
consume_member_credits(p_workspace_id UUID, p_user_id UUID, p_period_start TIMESTAMPTZ, p_amount INT, p_limit INT)
  RETURNS TABLE (allowed BOOLEAN, used INT)

-- 4. ledger gains the wallet dimension
ALTER TABLE public.credit_usage_events
  ADD COLUMN IF NOT EXISTS wallet TEXT NOT NULL DEFAULT 'workspace'
    CHECK (wallet IN ('workspace','personal','seat')),   -- 'workspace' = legacy pooled rows only
  ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS credit_usage_events_payer_period_idx
  ON public.credit_usage_events (payer_user_id, period_start);

-- 5. workspace_credit_usage + consume_workspace_credits STAY (no drop this wave). COMMENT ON TABLE
--    marks them retired-from-writes; the drop is its own later migration (file an F-NNN).
```

Ledger row semantics from now on: `workspace_id` = the **addressed container** (the workspace row
the caller was authorized into — for a home-space burn that is the link/personal container itself,
so the NOT NULL FK holds and the home overview's `origin_workspace_id IN (…)` reads keep working
unchanged); `origin_workspace_id` = same id; `user_id` = caller; `payer_user_id` = the wallet owner;
`wallet` = `'personal' | 'seat'`; `period_start` = the wallet's period key.

## 5. Server contract — `src/features/billing/server/`

### `credit-wallets.ts` (NEW repository; keep `workspace-billing.ts` for the billing row/seat reads)
```ts
export interface CreditConsumeRow { allowed: boolean; used: number }
export function consumeUserCredits(userId, periodStart, amount, limit): Promise<CreditConsumeRow>      // rpc consume_user_credits
export function consumeMemberCredits(workspaceId, userId, periodStart, amount, limit): Promise<CreditConsumeRow> // rpc consume_member_credits
export function getUserCreditsUsed(userId, periodStart): Promise<number>          // no row = 0
export function getMemberCreditsUsed(workspaceId, userId, periodStart): Promise<number>
```
`consumeWorkspaceCredits` / `getWorkspaceCreditsUsed` are deleted from `workspace-billing.ts`
(nothing may write the retired counter).

### `credits-service.ts`
```ts
export interface CreditCaller { userId: string; workspaceKind?: WorkspaceKind }   // unchanged
export type UnmeteredReason = "container-has-no-active-owner";                    // the only one left
export type BillingTarget =
  | { wallet: "seat";     workspaceId: string; payerUserId: string }             // payer = caller
  | { wallet: "personal"; workspaceId: string; payerUserId: string }             // workspaceId = addressed container; payer = owner
  | { wallet: null;       workspaceId: string; payerUserId: null; reason: UnmeteredReason };
export async function resolveBillingTarget(workspaceId, caller: CreditCaller): Promise<BillingTarget>
export interface CreditsSummary extends CreditPeriod { wallet: WalletKind | null; used; limit; remaining; degraded?: true }
export interface CreditConsumeResult extends CreditsSummary { allowed: boolean; upgradeUrl: string }
export async function consumeMcpCredits(workspaceId, caller: CreditCaller): Promise<CreditConsumeResult>
export async function summarizeCredits(target: BillingTarget, billing: WorkspaceBillingRow | null, memberCount: number): Promise<CreditsSummary>
export function unmetered(): UnmeteredResult   // wallet: null, degraded: true — unchanged posture
```
`caller` becomes REQUIRED (the seat wallet needs the user). `upgradeUrl` is **empty** when there is
nothing to buy: personal wallet (no paid tier), or a seat on an already-paid plan. Non-empty only
for a seat on a FREE-verdict workspace. Ledger write stays fire-and-forget, only on `allowed`.

### `status-service.ts` — `GET /api/billing/status`
`credits` = **the caller's own meter** for the addressed container (their seat, or the personal
wallet when they are the owner). A non-owner peer in a link container still gets `unmetered()`
zeroes (the existing privacy fence — the owner's wallet is not the peer's to read).
Payload gains `credits.wallet: "personal" | "seat" | null`. Nothing else on the payload changes.

### Client mirror — `components/use-workspace-entitlements.ts`
`WorkspaceCreditsStatus.wallet: WalletKind | null` with a stale-cache fallback
(`wallet: raw.credits?.wallet ?? null`) and a test that replays a pre-field cached row (INVARIANTS
§8 stale-cache rule). `DEFAULT_STATUS.credits.limit = PERSONAL_MONTHLY_CREDITS`. Export
`TEAM_SEAT_PRICE = 8`. Keep `isSolo` (legacy row), `isTeam`, `isPaid`.

## 6. Wire — `POST /api/mcp/credits/consume` → `@dopl/client › consumeCredits` → registrar

Response is `CreditConsumeResult` (adds `wallet`). Fail-open posture, `degraded` stamp, `minRole:
"guest"`, `writeScopeExempt` — all unchanged. Registrar: `creditsExhausted(outcome)` takes the whole
outcome and renders ONE of:

- seat, free verdict: `Your seat in this workspace is out of credits for this period ({used}/{limit}). Resets {periodEnd as YYYY-MM-DD}.\n\nUpgrade to Team for 5,000 credits per member: {upgradeUrl}`
- seat, paid: `Your seat in this workspace is out of credits for this period ({used}/{limit}). Resets {date}.`
- personal: `Your personal credits are used up for this month ({used}/{limit}). Resets {date}.`
- `wallet` missing/null (older server): the existing generic `CREDITS_EXHAUSTED_MESSAGE` + url if any.

Only `allowed === false` refuses (keep). Rebuild BOTH `packages/*/dist` (committed-dist gate).

## 7. Plans, Stripe, routes

- `PlanId` stays `"free" | "solo" | "team"` (legacy rows). `CheckoutPlan = "team"` only;
  `parseCheckoutPlan` accepts only `team`. `PLANS` = Starter + Team (Solo card deleted). Starter
  features: `100 credits per member / month`, `Unlimited members`, keep object-cap + chat-window
  lines. Team: `$8.00 / seat / month`, `5,000 credits per member / month`, `Unlimited members`,
  uncapped objects, full history, seats sync line.
- Checkout route: `readPlan` → `team` always; a body asking for `solo` → 400 `PLAN_RETIRED`. The
  `SOLO_REQUIRES_SINGLE_MEMBER` branch is deleted. `upgrade-to-team` route STAYS (legacy solo →
  team in place). Webhook `derivePlan` STAYS (legacy price → `solo`). `seats.ts` unchanged.
  `entitlements.ts`: `paidEntitlement` unchanged (solo live + ≤1 member = paid; degrades to free
  at 2+), `assertCanAddMember` unchanged.
- Pricing page: TWO columns (Starter / Team). Rows: Ontology objects, Chat history, Members
  (`Unlimited` both), **Credits (`100` / `5,000`, sub `per member / month`)**, Price (`Free` /
  `$8.00`, sub `/ seat / month`). Upgrade modal: Team only; the `generic` variant no longer offers
  Pro; `PAID_UNLOCKS` credits line → `5,000 credits per member every month`.
- Usage pane: meter label `Your credits` (seat) / `Personal credits` (personal); sub-line
  `Resets {date}`; Members line unchanged. **Minimal UI copy ruling: label + control, no explainer
  paragraphs** — delete the existing two-sentence intro under "Usage this period".
- Desktop Home credit bar (`apps/desktop-ui/src/pages/home/overview-sections.tsx`): denominator
  falls back to `PERSONAL_MONTHLY_CREDITS`, never a workspace plan figure.

## 8. Tests & gates (definition of green — INVARIANTS §14)

Every slice: mutation-verify and state the count. Pins that MUST move: `credits.test.ts`,
`credits-service.test.ts` (call-count budget: 3 seat / 2 link / 1 personal), `credits-link-reroute.test.ts`
(rewrite: link → owner's PERSONAL wallet, no ambiguity branch), `status/route.test.ts`,
`consume/route.test.ts`, `route-guest-floor.test.ts`, `schema-sql.test.ts`,
`shared/tenancy/personal-container-schema.test.ts` (the "lands on the owner's standard workspace"
pin inverts), `use-workspace-entitlements` stale-cache test, `packages/mcp-server/src/credits.test.ts`,
`container-lock.test.ts`, `url.test.ts`, checkout/webhook/stripe tests, `plans-billing.test.tsx`,
`billing-page-screen.test.tsx`, desktop `overview-credit-bar.test.tsx` / `home-test-harness`.
Gates: `npm run test:all`, `npx eslint --max-warnings 0`, `npm run typecheck`,
`npm run typecheck -w @dopl/desktop-ui`, `node scripts/check-doc-refs.mjs`,
`npx tsx scripts/check-role-drift.ts`, `npx tsx scripts/check-rls-pair-gate.ts` (replays every
migration as SQL text — the new file must parse), `check-knowledge-type-drift`,
`check-session-health-drift`, `check-message-kind-drift`, `check-css-token-drift`, committed-dist
check, `npm run build` at root, and CI's `rls-redteam` job (the only gate that starts a database —
it cannot run on the authoring machine; INVARIANTS §14 is the authority, this list is a claim).

## 9. Ownership (wave 1, parallel, disjoint)

| Agent | Owns |
|---|---|
| A core | migration; `billing/credits.ts` (+test); `billing/plans.ts`; `billing/server/{credit-wallets.ts (new), workspace-billing.ts, credit-ledger.ts, credits-service.ts, status-service.ts, entitlements.ts}` (+tests); `app/api/mcp/credits/consume/*`; `app/api/billing/status/*`; `billing/components/use-workspace-entitlements.ts` (+stale-cache test); `features/knowledge/schema-sql.test.ts`; `shared/tenancy/personal-container-schema.test.ts`; `features/home/**` compile fixes only |
| B mcp | `packages/dopl-client/src/**` (consumeCredits type); `packages/mcp-server/src/**` (registrar, respond, credits.test, container-lock.test); rebuild + commit both `dist/` |
| C ui | `shared/layout/settings-modal/sections/{plan-cards,plans-billing-core,plans-billing}.tsx` (+tests); `billing/components/{upgrade-modal,embedded-checkout,billing-usage-pane,billing-plans-pane,billing-page-screen}.tsx` (+tests); `marketing/components/pricing-content.tsx`; `members/components/{invite-dialog,members-v2/members-v2-view}.tsx`; `members/hooks/use-join-requests.ts`; `apps/desktop-ui/src/**` |
| D stripe/routes | `billing/url.ts` (+test); `app/api/billing/{checkout,upgrade-to-team,cancel,portal,webhook}/**`; `app/billing/**`; `billing/server/{stripe,seats,webhook-handler,subscriptions,billing-account-service}.ts` (+tests); `onboarding/{constants,schema}.ts`; `analytics/server/launch-metrics.ts`; `features/workspaces/server/workspace-kind.test.ts`, `knowledge/server/service-storage.test.ts`, `billing/kb-storage.test.ts` solo mentions |

Wave 2: review + fix; docs (INVARIANTS §10 credit bullets, §4A billing bullets, ENGINEERING
stratum, REFACTOR-FINDINGS with ids ≥ F-667 re-derived across branches); gates; local commit.

## 10. Deviations landed (2026-09-08)

Six differences between §§1-9 and the tree, all reported by the builders rather than improvised.
None changes the model; each is recorded because a spec read after the fact is otherwise a lie about
the code.

1. **`CheckoutPlan` is an explicit literal, not `Exclude<PlanId, "free">`.** §7 said the type
   subtracts; `billing/url.ts` writes `type PlanIdSubset<T extends PlanId> = T;` and
   `export type CheckoutPlan = PlanIdSubset<"team">`. **Subtraction WIDENS**: adding `"enterprise"`
   to `PlanId` would have grown `CheckoutPlan` to `"team" | "enterprise"` on its own, with no edit
   and no type error — a new plan made checkout-able by the act of naming it. Written out, a new
   plan reaches checkout only when a human types it there, and the `PlanIdSubset` constraint still
   fails to compile if `team` is renamed or retired in the taxonomy. Zero runtime cost.

2. **`unmetered().upgradeUrl` is `""`.** §5 left it unstated by saying the posture was "unchanged";
   it had carried the billing link, which pointed a caller at a checkout for a refusal that never
   happened. It now matches the consume route's own `failOpen()` **byte for byte** — the two
   degraded answers differing at all is what lets one reader treat them differently, which is the
   whole argument for the `degraded` stamp.

3. **`credits-service.test.ts` was SPLIT**, not just moved: the period/window cases live in
   `server/credits-service-window.test.ts` and the routing + call-count budget stayed in
   `credits-service.test.ts`. Rewriting one file for two wallets took it past the 500-line cap
   (INVARIANTS §1), and the seam is real — window resolution is arithmetic over a billing row, the
   budget is mock call counts over a resolver.

4. **`upgrade-modal.tsx` was SPLIT into `upgrade-modal-parts.tsx`** (353 / 235, `wc -l`
   2026-09-08). §7 only asked for Team-only copy; retiring Solo deleted enough of the file to make
   the long-scheduled split cheap, so its `eslint.config.mjs` over-cap exemption was **deleted
   rather than moved**. See F-093.

5. **`tool-budget.test.ts › SERVED_TOTAL_CEILING` was re-banked, 47,319 → 47,299 (−20).** Not in
   §8's list. `tools/tool-errors.ts › CREDITS_EXHAUSTED.meaning` went from "this workspace is out of
   credits…" to "you are out of credits…" (−10 chars, served twice), because an allocation is per
   person and never pooled — the old sentence sent a member to an admin who had nothing to refill.
   ⚠ Never quote that ceiling; re-derive it.

6. **`isCurrentPlan`'s Starter arm stays `!isPaid`**, not `plan === "free"`. With the Solo card
   gone it would have been natural to key both arms on the id; `!isPaid` is what keeps a **degraded
   solo** (a live solo row that grew a second member, `entitlements.ts › paidEntitlement`) and a
   canceled row rendering Starter as current — which is what the workspace is actually entitled to.
   The verdict decides the card, exactly as it decides the allowance.
