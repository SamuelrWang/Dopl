# Snapshot: Dopl KB "Tech Debt and Tabled Items" (2026-09-17)

Source: Dopl KB base "Dopl MCP Improvement Spec" (id 8dd43982-48be-4be5-b855-a740ec711d38), entry "Tech Debt and Tabled Items", version 2026-09-16T04:55Z. Copied verbatim for the parity synthesis because the rulings-archive researcher could not reach that base. The KB entry is the record; this file is a read-only snapshot.

## Tabled 2026-09-15

- **Message-pill face**: pill currently shows raw "#NNNN". Option: show snippet or timestamp of the target message instead. Zero urgency; revisit if Samuel finds raw numbers ugly in use. (Context: per-channel numbering project killed same day — pill + internal global seq is the accepted model. Full analysis: NUMBERING-SPEC.md in repo root.)
- **Per-channel numbering**: rejected as unnecessary once click-to-jump pills shipped. Do not revive without re-reading NUMBERING-SPEC.md — "#" notation is spent (global), and the pill's safety gate depends on it.
- **Transcript-fetch dev log line** (ghost-message instrument): Samuel ruled NO 2026-09-15. If another message ever fails to paint, this is the first thing to build — one dev-mode line per transcript query. See GHOST-CAPTURE.md.
- **Agent-own address thread (design question)**: should an AGENT keep its OWN thread of last-addressed rather than sharing its operator's? Today it shares entirely — that sharing is what made the F-704 stomp possible; the fixes make the human's authoritative and give agents none. Revive trigger: someone wants an agent's untagged posts to auto-route at all. F-704 and F-705 are RESOLVED AND COMMITTED (bb39ac61, c695f824) — do NOT reopen the fixed bugs; only this design question is parked.
- **(c') configurable fallback responder**: role/template-pinned untagged-message fallback with a picker. Superseded by simpler ruling (dead agent → nobody, c695f824). Build only if "nobody" ever feels like a stall. Buys configurability, NOT a no-stall guarantee.
- **T2 durable in-app tool-gate surface**: inline Approve/Deny buttons at the point of a held tool ask. Design settled (LOCAL IPC lane only — never a server consent row; live outcome row, not narration). **UPDATE 2026-09-17: BUILT** — commits b985fe31 + 144b9849 (agent-held-gate card, sessions:answerPermission IPC), on master.
- **CI guard, stale dist**: src-newer-than-dist check for packages/mcp-server — second occurrence of the trap 2026-09-15 (first 2026-07-17). Proposed in MCP-GAP-AUDIT.md §5.2.
- **T1 scope op=status to bound channel**: the enumeration inconsistency behind rejected fix-2 (widen rooms.list). Wants a ruling, not a one-liner. GATE-BUG-REPORT.md.
- **F-702 (OPEN)**: dopl_agent teaches reason=ambiguous_name but ambiguousTemplate never routes through refusal() — the literal hits no wire. One line + budget re-measure.
- **Cross-thread citation looseness**: a pill citing a message inside a thread reads "older than the loaded history" when it is merely elsewhere. Sharpen if cross-thread citations get common (a24c11cd note).
- **MCP gap checklist**: the main deliverable of the audit — MCP-GAP-AUDIT.md actions/reads gaps (pin/unpin, description-after-create, home-channel description, ontology grant, revision history, credits balance, etc.) plus rulings already made: claim-links = read-only first; description = own MCP argument. Largely unimplemented.

## Also tabled by Samuel in conversation, 2026-09-16/17 (not yet in the KB entry)

- **Home Info-tab DM display-only rule**: /home's click-to-edit keeps `!channel.isDirect` from the workspace tab; home containers minted before the 2026-08-24 channel-first inversion still carry `is_direct = true` and stay display-only. Samuel has not ruled ("lift it on home" would remove the condition for /home).
- **/home channel record click-to-edit follow-up**: ruled YES 2026-09-17 and BUILT (43c40598).
- **Hero photo experiment**: swap reverted (03506fcd) because the hero banner's geometry follows its photo's aspect; a "photo-agnostic hero" (fixed landscape aspect + cover crop) is the enabling change if he wants to retry.
