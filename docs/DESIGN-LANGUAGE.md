# Dopl Design Language — "identity" look (2026-10-22)

The visual direction Samuel approved while rebuilding the landing page's product
mockups (Orchestration tabs, identity cards, Devices band, Monitoring log) and the
hero demo's redesigned thread card, agent card and message boxes. He intends to
carry it into the real product. **Read this before designing any new UI or
restyling an existing surface.** It is the taste reference; `docs/DESIGN-SYSTEM.md`
stays the source of truth for tokens and kit classes in the product.

Measured values below come from the shipped code (2026-10-22). When porting to the
product, turn literals into tokens/kit recipes in `src/app/globals.css` +
`apps/desktop-ui/src/styles/tokens.css` + `docs/DESIGN-SYSTEM.md` (the product
forbids hand-rolled values); never fork them locally.

---

## 1. Principles

1. **White surfaces, not grey.** Cards are `#ffffff` on a white or near-white page.
   Grey is reserved for small *wells* inside a card (`#f5f5f5`) and pressed states.
   Big grey backgrounds and dark slate frames read as clunky.
2. **Hairlines, not heavy borders.** 1px `#ececec` (landing) / `--border-default`
   (product). A coloured border means *identity* (see §4), never decoration.
3. **One soft shadow.** Cards float on a two-layer, low-opacity shadow, never a
   wide spread: `0 1px 2px rgba(0,0,0,.04), 0 6–8px 16–22px rgba(0,0,0,.04–.05)`.
4. **Fewer things on screen.** A mockup shows the 3–5 things that matter. Prefer
   dropping a row over shrinking text.
5. **Restrained colour.** Greys + near-black ink (`#0d0d0d`) + ONE accent per
   scene: the agent's colour (`--agent-color-NN`). Green only for live/online
   (`#2fa45a`), amber only for "needs you".
6. **Every agent is an identity of a person.** Never a generic bot glyph when a
   person owns it: their photo + the runtime badge (see §3).
7. **Show function, not decoration.** Devices show what they let an agent *do*
   ("Connected" + function chips); tool calls show the real call.

## 2. Type, colour, spacing (landing values)

| Role | Value |
|---|---|
| Ink (titles, names, values) | `#0d0d0d`, weight 500–600 |
| Body | `#3d3d3d` |
| Muted (meta, captions, times) | `#8a8a8a` (`--muted`) |
| Hairline | `#ececec` |
| Well / inset | `#f5f5f5` |
| Live / online | `#2fa45a` dot |
| Card radius | 12px (message/agent cards), 14px (thread card, windows), 999px pills |
| Card padding | 10–14px; header rows gap 8–10px |
| Card shadow | `0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.04)` (message) / `…0 8px 22px rgba(0,0,0,.05)` (thread card) |
| Notification shadow | `0 2px 8px rgba(0,0,0,.06)` |
| Monospace (tool calls, IDs, code) | `ui-monospace, SFMono-Regular, Menlo, monospace`, 11.5–13.5px |

Sentence case everywhere. Titles are short noun/verb phrases.

## 3. The identity avatar (codified)

`src/shared/ui/identity-face.tsx › IdentityFace` (spans only, so it is valid inside a `<p>`):

- **Ratio — `IDENTITY_RING_PX = 2`:** 2px agent-colour ring → 2px white → photo, at
  every size. `ring` takes the agent's `AgentColorKey`, or `"neutral"` (the raised
  hairline) for a saved identity, which has no colour; no ring is a person (plain
  photo on a hairline). No photo falls back to initials, or the profile glyph.
  Samuel arrived at this from the Monitoring log and wants it everywhere identities
  show. `PairedAvatar thinFrame` (onboarding) renders through it.
- **Runtime badge:** half the avatar's diameter, hanging `0.3 × badge` past the
  bottom-right, on a raised light face with the same 2px colour ring. The badge
  never gets the white frame. No runtime, no badge.
- **Presence:** a 7px green dot at the top-right (`online`), so it never sits on the
  badge. Green only for live (§1).
- **Photo** = the person who owns the identity. **Badge** = the runtime
  (Claude / ChatGPT / Grok Bot / Muse / Gemini logo).
- Small sizes: 16px (breadcrumbs), 20–22px (rows), 28–34px (headers).
- Entrance animations FADE, never scale (a scaled avatar rasterises soft).
- Onboarding/login keep the raised scaled `Profile` frame unless a caller opts in.

## 4. Components (reference implementations)

| Component | Recipe | Reference |
|---|---|---|
| **Message card** (received / posted) | White, 12px radius, **1.5px border in the sender's agent colour all the way round** (black for a person, `--border-strong` fallback), soft shadow. Header row: identity face + "Received from @x · time" / "Posted to <thread> · time", grey addressee pills. Body = normal message rendering. No filled colour banners. | `channels/components/agent-stream-card.tsx` (product) |
| **Agent card** | White card (`.white-card`), 12px. Header: `IdentityFace` d=30 (owner photo, agent-colour ring, runtime badge) + name (600) + **status pill** (`StatusPill`, green dot when running). "↳ thread · identity · model · permission" muted. **Context** label + "38k / 200k" right-aligned over a **3px meter** in the agent colour (`ThinMeter`). Footer: muted "tokens spent", quiet delete icon, outlined Open / Viewing pill. | `channels/components/agents-tab-cards.tsx`; `ontology-agent-rail.tsx` |
| **Thread card** | White card, hairline, 14px, soft shadow. Header: small raised mark tile + the thread's name at 15/500; the opening ask as a muted 2-line description; addressee pills; a well listing the agents in the thread (identity face, name, whose agent, status pill; the viewer's own rows open their view; "N running" on the count line; three rows then it scrolls); a hairline-fenced footer with "Opened by…", a quiet Launch agent and an ink Open thread pill. | `channels/components/thread-card-row.tsx`, `thread-card-agents.ts` |
| **Info well** (agent detail) | Grey well, 4 columns: Context (value + 3px meter), Permission (**dropdown face**: "Auto" + chevron, not a segmented Ask/Auto/Full), Runtime (logo + name), Parent (face + name). | `ontology-command.tsx`, `.lp-ont-info`, `.lp-ont-select` |
| **Breadcrumb** | Sits ABOVE the agent box, not inside: tiny faces + names, `›` separators in `#c9c9c9`, current item ink 500. | `.lp-ont-crumbs` |
| **Chat rows** | Avatar + bold name + muted meta inline, text below, all left-aligned; agent posts keep a 3px side bar in their colour. User bubble on the right is near-black with white text; agent bubble is the well grey with an inset colour bar; each message has its sender's face. | `ontology-windows.tsx` (channel), `ontology-command.tsx` (lane) |
| **Tool row** | Small raised mark tile (Dopl mark for Dopl tools) + bold tool/device name + monospace call in muted grey + ✓ when done; running state pulses the tile and shimmers the call. | `robot-chat.tsx`, onboarding `connect-agent-transcript.tsx` |
| **Notification** | White, hairline, 12px, `0 2px 8px rgba(0,0,0,.06)`, Dopl mark, bold title, muted body; decisions get Approve (black pill) / Deny (outlined). | `.lp-ont-notif` |
| **Composer** | Full pill, 1px hairline, white, placeholder muted, round black send button (ArrowUp). | `.lp-ont-composer`, docs `docs-ask-pill` |
| **Status / device pill** | Dot + word, or the product's black device pill with a hairline when over a photo. | `.lp-ont-live`, `device-pill.tsx` |
| **Connect pill** | Real `LiquidGlass` (`radius 14, edge="rim", staticMap`, small tight shadow), "Device · Connected" + monospace function chips. | `device-connect.tsx` |
| **Code window** | White window, grey dots, title right, monospace, comments grey + bold, URLs/strings `#4d83c4`, a copy icon per copyable line. | `connect-section.tsx`, `sdk-section.tsx` |
| **Liquid glass** | Always the real `LiquidGlass` with the hero-banner settings; replace its heavy drop shadow with a small one; never fake glass with a semi-opaque fill. | `hero-banner.tsx`, `.lp-mp-notify-glass` |

In the product these recipes are already kit and `src/shared/ui` primitives (2026-10-26):
the white card `.white-card`, the well `.card-well`, `StatusPill`, `ThinMeter`,
`IdentityFace` / `IdentityStack`, `Breadcrumb`, `EmptyState variant="well"`, `PILL_BUTTON`, the ink pill
family (`INK_PILL_FACE`: `PAGE_ACTION_BTN`, `SMALL_PRIMARY_PILL`, `INK_PILL`, `QUIET_PILL`), and
the 15px `text-heading` step. A port imports them; DESIGN-SYSTEM.md lists each.

## 5. Motion

- Mockups **play once when in view**, then hold the final frame; reduced motion /
  no JS render the final frame (base CSS = end state; `data-play="armed|in"`).
- Sequences are timed from content (derive slots from the message list) so copy
  edits never desync. Typed reveals for agent replies; chat feeds slide older
  lines up and out the top of a fixed box.
- Progress meters ARE the clock (tab tours): fill in step with the animation,
  advance the moment they are full, never pause on hover/focus, always visible.
- Fade + 12px rise for section reveals (500ms, `--lp-reveal-ease`), staggered.

## 6. Copy voice (enforced by Samuel)

Professional and specific (Natural.com's voice). One declarative sentence per
card, 10–20 words; developer copy uses real technical nouns (typed API, endpoint,
presence, scoped permissions). **No em/en dashes, no staccato fragments, no
buzzwords, no childish CTAs.** Prosumer sections say "identity", not "agent"; never
list device types as if they were the only ones. Headings two balanced lines max.

## 7. Process rules (how to apply this)

- **Granular, not big-bang.** Two whole-app reskins were rejected. Change one named
  component, let Samuel review live, then the next.
- **Prototype demo-only first.** Shared product components are re-faced inside the
  landing's hero demo only (product element hidden, redesigned face placed in the same
  spot) so the real app is untouched until he approves. Then port properly: tokens + kit
  in the product, both channel UIs (web `src/features/channels` and the desktop SPA)
  together, and delete the demo face.
- Match a real product screen when designing a mockup; simplify it, don't invent.
- No screenshots as sign-off; Samuel reviews live.
