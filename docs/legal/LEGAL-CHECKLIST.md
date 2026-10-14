# Legal launch checklist — Services Agreement + Privacy Policy

Drafted 2026-10-14 from a code inventory of master `7b7f676e`. Drafts: [SERVICES-AGREEMENT.md](SERVICES-AGREEMENT.md), [PRIVACY.md](PRIVACY.md).

## Blockers — the documents are not true until these are done

1. **Confirm the contracting party.** Drafts say "Samuel Wang, an individual doing business as Dopl." Confirm the exact legal name. Unincorporated = personal, unlimited liability for agent-caused damage claims; forming an LLC/C-corp before scale is strongly advised (then swap one line in both docs; Agreement §27 already allows assignment to an entity you form). File a California fictitious business name (DBA) statement for "Dopl" in San Francisco County.
2. **MCP log retention (Privacy §10, §11).** `mcp_events` stores tool-call **arguments** (content) and today keeps them forever; account deletion only nulls `user_id`. Policy promises: 90-day purge + strip arguments/response summaries on account deletion. Implement (cron + delete route) or change the text.
3. **Content left in shared workspaces after deletion (Privacy §11).** FK behaviour is mixed (some `CASCADE`, some `SET NULL`). Trace `channel_messages`, `knowledge_entries`, `skills`, `chats`, ontology rows and state the real outcome.
4. **Glasses audio (Privacy §3.8).** Confirm audio is not persisted after transcription (`src/features/glasses/core/voice/stt.ts`, `glasses_messages`).
5. **Backups (Privacy §10).** Confirm Supabase backup/PITR retention for the project's plan; fill in the day count.
6. **Remove the old "improve AI model quality" claim.** Live `/privacy` + `/terms` say interaction data trains/improves AI — no code does this; the new drafts say we don't train. Ship the new pages.

## Acceptance and enforceability

7. **Record acceptance.** Store per user: agreement version, timestamp, IP/user agent, surface (web/desktop). No record exists today. This is the most-litigated element of arbitration enforceability.
8. **Strengthen sign-up notice.** Current "By continuing, you agree…" is sign-in-wrap. Keep links adjacent to the button, rename to "Services Agreement," and make it conspicuous; add it to Google One Tap and GitHub flows too.
9. **Age.** Docs require 18+. Add an age affirmation at sign-up (checkbox or "I'm 18 or older" in the notice).
10. **Existing users.** Material change → email + in-app notice ≥30 days before effective date (Agreement §26). New arbitration clause applies to existing users only after that notice; their 30-day opt-out window starts on acceptance.
11. **Opt-out inbox.** Monitor build@usedopl.com for "Arbitration Opt-Out" and log each opt-out against the account.

## Billing (ROSCA / California ARL)

12. **Checkout disclosure.** Immediately next to the Stripe subscribe button, show: price, "renews monthly until you cancel," how to cancel (Billing page), and for Team, per-seat + prorated seat changes. Verify the embedded checkout shows this unavoidably (not just a link).
13. **Consent records.** Keep checkout consent evidence ≥3 years or 1 year after termination, whichever is longer (Stripe session records + your acceptance log).
14. **Cancellation path** stays online, ≤ as easy as sign-up (Billing → Cancel / Stripe portal). No retention maze.
15. **Price-change emails.** No email sender exists besides Supabase Auth. Before any price change, set up transactional email to give 30-day notice (Agreement §9.6).
16. **Legacy $7.99 seat subscriber.** Agreement lists $8.99; the one legacy subscriber keeps their checkout terms (§9.1 covers this) — no action unless you migrate them, which needs notice + consent.

## Platform obligations

17. **DMCA agent.** Register "Samuel Wang d/b/a Dopl" at <https://www.copyright.gov/dmca-directory/> ($6, renew every 3 years). Safe harbor doesn't exist until registered.
18. **CSAM reporting.** Agreement §7 says we report to NCMEC — know how (CyberTipline) before you need it.
19. **Privacy request handling.** Define who answers build@usedopl.com requests, verification steps, and a 30/45-day clock. Consider a `privacy@usedopl.com` alias.
20. **Provider terms.** Confirm OpenAI and Groq API settings (no training; OpenAI DPA accepted). Confirm Supabase, Vercel, Stripe DPAs/SCCs are in place (all offer them self-serve).
21. **AI-provider ToS fit.** Dopl drives users' own Claude/Codex/Grok/Muse/Cursor accounts. Check each provider's consumer terms allow third-party app use of a subscription login (esp. Claude `setup-token` and full claude.ai login). Agreement §5.1 puts compliance on the user, but a provider ban would break the product.
22. **Groq env.** `GROQ_API_KEY` is used in code but missing from `.env.example` — document it, or drop Groq from the policy if unused in prod.

## Publishing

23. **Wire the pages.** Replace `src/app/terms/page.tsx` + `src/app/privacy/page.tsx` content, rename the terms title to "Services Agreement," update `legal-page.tsx` "Last updated," and update `src/app/legal-pages.test.tsx` (pins 13 sections, "Last updated: April 2026," old titles). Consider a `/services-agreement` route with `/terms` redirecting to it.
24. **Link everywhere.** Login/sign-up form, desktop signed-out screen, marketing footer (none today), Billing page, desktop app settings/About.
25. **Lawyer review** before publishing — the agent-actions liability allocation (§5.2, §19) and sole-proprietor posture are the highest-risk parts.
26. **Review annually**, and whenever pricing, providers, data flows, or features change. Next review: 2027-10.
