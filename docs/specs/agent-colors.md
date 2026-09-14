# Agent colours, accented posts, and the message filter (2026-09-13; restyled 2026-09-14)

## Samuel, verbatim

> "for each agent I want to assign it a color. … for each message that the agent
> sends in that channel, I want a specialized UI where it has a border line around
> that message from that agent in that specific color. There is a top bar, similar
> to the posted channel bar, that is that color. The pill for that agent is now
> moved to the left so that it's in the bar but on the left side of the bar. …
> For desktop agents and for messages from users, keep those white and without
> any box. … If it's an agent in Dopl that's sending something, that should be a
> specific color. For the agent view, for whatever color that agent has been
> assigned, I want you to change that agent view (the posted-to-channel box) to
> be the same color. … this will be categorized not only for the own users'
> agents, but also for other users' agents. … each channel can have its own set
> of colors. We have to make sure that there aren't the same colors in a channel.
> … There needs to be a good amount of colors because it might usually have a lot
> of agents. I want the colors to only apply to agents that are in the recent,
> basically agents that are currently active or are waiting. Only those kinds of
> agents should have a color, because once the agent has ended, that color needs
> to be returned to the color bank to be used again. … On the top, next to the
> left of the toggle bar for collapsing the right-side panel, I want us to add a
> dropdown … filtering by messages: All … Just users, which would include desktop
> agents as well: all of the messages that don't have a colored box around them
> … Individual agents … when the user clicks New Agent in the New Agent pop-up, I
> want you to change 'Blank Agent' to 'None' for the template. At the bottom,
> under Runtime, add multiple little circles that will act as the color switcher
> … If that color already exists on the agent, that color should be unselectable.
> That will be scoped to a channel, so if there are multiple users in that
> channel, we need to make sure their agents should be pulled from the color. If
> my agent is a specific shade of red, then the other user should not be able to
> launch an agent with that specific color of red either."

## Decisions (Desktop Agent; Samuel tweaks live)

- **Palette**: 16 named keys `agent-01 … agent-16`, defined ONCE as tokens
  `--agent-color-01 … -16` in both palettes (globals.css + tokens.css; drift gate
  covers them), hues spread around the wheel at one saturation/lightness so any
  two read apart; a `--agent-color-NN-soft` tint for the box fill is derived in
  CSS (`color-mix`), not a second token set.
- **Ownership**: the colour belongs to a SESSION in a CHANNEL (`channel_sessions`
  or the sessions row that channel-level agents already have — measure), column
  `color TEXT NULL` constrained to the key set. **Uniqueness is server-side**: a
  partial unique index on `(channel_id, color) WHERE ended_at IS NULL` (or the
  equivalent live predicate the table has), so two members cannot launch the
  same colour, and ending frees it. The launch path (desktop launch, MCP
  `manage launch`, the New agent popup) sends a chosen key or omits it; the
  server assigns the FIRST FREE key when omitted, and answers 409 with the free
  set when the chosen one is taken.
- **Ended agents**: their past posts lose the colour (the key is back in the
  bank) and render with a neutral `--border-strong` ring + bar
  (`agent-box-rule.ts › AGENT_ACCENT_NEUTRAL`), so they still read as agent posts.
  Live = not ended (Thinking / Idle / Waiting all keep it).
- **Who gets an accent**: posts whose author is a CHANNEL AGENT session (has a
  session id). People and channel-less MCP posts ("Desktop agent") stay white,
  no ring and no bar, pill as today. The predicate is `agent-box-rule.ts › agentBoxOf`
  — its "box" name is history and was deliberately not renamed with the face, because
  the filter's "People" option is its literal complement.
- **The post's face** — ⚠ **SUPERSEDED 2026-09-14, and the first paragraph is kept only so the
  replacement reads as a replacement.** ~~a `border` in the agent's colour (2px),
  `rounded-[14px]`, a top bar in the SAME colour (same height/geometry as the pop-out's
  "posted to channel" bar) holding the attribution PILL on the LEFT and nothing on the right;
  the body below on white.~~ Samuel, over a screenshot of that box: *"instead of it being an
  entire box, I want to change it to instead be a vertical bar. For messages that are right
  aligned, this bar should sit to the right, for messages left aligned, bar should be on the
  left. And move the agent/user identification pill to the right again, And basically, have the
  colored box, instead of this long box, make it just around the pill, like a bordering, rounded
  to fit. and it's attached to a vertical bar, that travels the length/amount of lines of the
  messages from that agent."* **What ships**: an agent's post is a person's post — same pill,
  same side, same continuation rule — wearing (a) a `ring-2` in the agent's colour on a
  `rounded-full` wrapper around the attribution pill, no ring-offset, and (b) a
  `w-[3px] self-stretch rounded-b-full` bar in the same colour on the post's OUTER edge — the
  bar's TOP end is SQUARE, per Samuel's same-day addendum *"where it connects with the bar, it
  should be a straight, not rounded"*, and only its far end is capped. The two touch: the column is inset 8px from the bar and the pill's wrapper takes an equal negative
  margin, so the ring is painted over the bar's inner 2px and the join reads as one 3px line.
  **One post, one bar** — a run does not merge, and a continuation keeps its bar without a pill.
  The frame, the top bar and the second row component (message-box-agent) are DELETED.
- **Pop-out**: the "posted to channel" bar takes the agent's colour. ⚠ **It did NOT follow the
  2026-09-14 restyle** (measured): it is a full-width delivery record with no side, no author
  and no pill, so a ringed pill and an outer-edge bar have nothing to attach to. Its geometry
  constant moved back into `agent-stream-sent-box.tsx › AGENT_BAR` when the transcript's top bar
  it was paired with was deleted.
- **Filter**: a `SelectMenu` (text face, chevron) immediately LEFT of the
  info-pane collapse toggle in the channel header: **All** · **People**
  (every post with no box: humans + Desktop agent) · then one entry per agent
  that has posted in the loaded transcript (colour dot + name; ended ones with a
  gray dot). Selection filters the rendered transcript client-side (threads and
  milestone/decision cards follow the same author rule), persists per channel
  in local state.
- **New agent popup**: template pill "Blank agent" → "None"; under Runtime a row
  "Colour" of 16 circles (20px, the token fill, 2px ring when selected); taken
  colours (any member's LIVE agent in this channel) are rendered at 35% opacity,
  `aria-disabled`, unselectable, with a title "In use by <agent name>"; default
  selection = first free. The taken set comes from the channel's live sessions
  projection (peer + own), refreshed by the same push the @-picker uses.
- **Wells / rail / badge**: the Agents-tab card and the pop-out rail row show a
  small colour dot before the name for live agents.

## Checklist (confirm item-by-item)

1. Migration `<next>_agent_session_colors.sql`: column + CHECK + partial unique
   index + comment; WRITTEN NOT APPLIED. Schema test beside the billing ones'
   pattern. RLS unchanged (column rides the row).
2. Contracts + zod: `@dopl/contracts` sessions gain `color: AgentColorKey | null`;
   drift script `check-session-health-drift.ts` if it covers this block
   (measure); SDK `dist` rebuilt.
3. Launch: desktop `session-launch.js` → the create call sends `color`; MCP
   `dopl_channel manage launch` gains optional `color`; server assigns first free
   / 409 on taken; end frees by the index predicate (no code). Peer projection
   (`channel_sessions` push) carries `color`.
4. Rendering: `channels/components/transcript.tsx` + `authored-row.tsx ›
   AuthoredRowAccent` (ring on the pill + outer-edge bar) for posts with a
   live/ended channel-agent session; tokens by reference; both channel surfaces
   (the web/desktop workspace pages and /home's `StandaloneChannelSurface` import
   the same tree, so this is one implementation). ⚠ 2026-09-13 shipped this as a
   separate message-box-agent box component; 2026-09-14 deleted it — see
   "The post's face" above.
5. Pop-out "posted to channel" bar colour.
6. Filter dropdown (`channels/components/transcript-filter.tsx`), left of the collapse
   toggle, All / People / agents.
7. New agent popup: "None" + colour circles + taken-set rule.
8. Dots on the Agents-tab cards + pop-out rail rows.
9. Tests + MUTATION-VERIFY three (uniqueness index, filter People excludes
   boxed posts, taken circle unselectable). Gates: the seven suites/lints/
   typechecks this repo's CLAUDE.md names, `check-session-health-drift`,
   committed-dist, `check-doc-refs`. 500-line cap. INVARIANTS §5 + DESIGN-SYSTEM
   rows (palette, box, filter).
