# Full Codebase Audit — 2026-06-01

Three parallel audits of `master`: **security**, **structural / code-quality**, and
**functionality + dead code**. Written to be readable without a deep technical
background. Nothing was changed during the audit itself; the "quick wins" below
were applied afterward in a separate pass.

- [`security.md`](./security.md) — auth, RLS, secrets, Stripe, SSRF, data exposure
- [`structural.md`](./structural.md) — file sizes, layering, React bugs, lint health
- [`functionality-map.md`](./functionality-map.md) — full feature map + dead-code purge plan

---

## The bottom line

The codebase is **healthier than most one-person products**: a real architecture
rulebook, disciplined debt tracking, hashed API keys, verified Stripe payments, and
an unusually strong defense against server-side request attacks. **No catastrophic
security hole was found.**

Two things are true at once:

1. There were **3 real React bugs** sitting in the code (pages that randomly break
   until refreshed). **Fixed** — see below.
2. The suspicion about **dead code is correct** — an entire unused alternate UI, a
   dead billing/credits system, and ~10 orphaned files. All three audits independently
   bumped into the same ghosts.

---

## ✅ Quick wins applied (2026-06-01)

| Fix | Files | Result |
|-----|-------|--------|
| 3 React "rules-of-hooks" bugs | `features/canvas/panels/skill/skill-panel.tsx`, `features/knowledge/components/knowledge-tree.tsx` | `rules-of-hooks` lint errors: 3 → 0 |
| Lint scanning the `.claude/` worktree | `eslint.config.mjs` (added `**/.claude/**` ignore) | Lint errors: 2,130 → 82 (fake noise removed) |
| API key passed as a process arg (A-025) | `packages/cli/src/commands/mcp.ts` | Key now passed via `DOPL_API_KEY` env, not visible in `ps` |
| Non-atomic MCP config write (A-031) | `packages/cli/src/commands/mcp.ts` | Temp-file + rename; Ctrl-C can't corrupt the shared MCP config |

Verified: typecheck clean on edited files, all `rules-of-hooks` errors cleared.
The 82 remaining lint errors are pre-existing debt unrelated to these fixes.

---

## Still open — recommended next steps

### Security (none critical)
- 🟠 **No spend cap on AI features** — chat / title / ingestion can run up unbounded
  Anthropic cost per user. Add a per-user daily token ceiling.
- 🟠 **Stripe checkout-status leaks another user's email** if a session ID is
  guessed/leaked — `api/billing/checkout/status/route.ts`. Check session ownership.
- 🟠 **Legacy admin endpoint** uses a timing-unsafe secret comparison —
  `api/admin/keys/[id]/route.ts:12`. The modern sibling already does this safely.
- 🟡 Cron-secret comparison (3 routes), workspace-member email exposure, in-memory
  rate limiter (resets per serverless instance), OAuth callback not bound to initiator.
- ⚠️ **Verify in the Supabase dashboard**: migrations only exist from April 2026
  onward. The oldest tables (`entries`, `api_keys`, `profiles`) predate that and
  aren't in the repo. App-layer code guards them correctly today, but confirm
  row-level security is enabled on them in the cloud project.

### Structural
- Split the oversized knowledge files (`knowledge/server/service.ts` is 1,064 lines)
  per `docs/TRACKED-DEBT.md#19`.
- 11 non-allowlisted files over the 500-line cap; 3 allowlisted files have grown past
  their granted size.
- 32 API route handlers carry business logic that belongs in `service.ts`.
- 6 features call Supabase directly from `service.ts` instead of a `repository.ts`,
  which is why raw DB field names leak into UI components.
- Turn on the rulebook's recommended lint rules (ENGINEERING.md Appendix A) so the
  contract stops being honor-system.

### Dead code — purge plan (safest first)
Confirmed by all three audits:

1. Delete empty `src/app/api/stats/` directory.
2. Delete `src/app/api/canvas/state/migrate/route.ts` (one-time migration, no callers).
3. Delete orphaned components (zero importers): `FixedChatSidebar`, `UpgradeModal`,
   `FilterSidebar`, `marketing/components/page-top-bar.tsx`, `shared/design/orb.tsx`,
   `shared/design/background-grid.tsx`.
4. Delete spent one-off scripts: `scripts/test-pipeline.ts`, `scripts/upgrade-samuel-to-pro.ts`.
5. Replace stale `agents.md` with a pointer to `docs/ENGINEERING.md`.
6. **Verify first:** delete `/design` page + its primitives (`Pill`, `GlowText`,
   `GlassNavbar`, …) — used only by `/design` itself.
7. **Verify first:** delete `/build` page + the whole `features/builder/` module —
   unreachable from the live sidebar.
8. Fix docs: remove `packages/chrome-extension/` and `features/onboarding/` references
   (neither directory exists).
9. Decide on `/browse/*` (not in sidebar; reachable only via legacy redirects).
10. Write a migration to drop the dead credits tables/functions (`user_credits`,
    `credit_ledger`, `*_atomic`) — zero code references — after a final Stripe check.
11. After a logging window: remove the `/api/ingest` and `/api/cluster/synthesize`
    "410-Gone" tombstones, and `/api/embed` + `/api/tags` if no external traffic.

See `functionality-map.md` for the full per-feature inventory and evidence for each
dead-code finding.
