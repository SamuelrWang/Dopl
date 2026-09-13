# Agent popout window — tabs, inset panel, agents rail (2026-09-13)

Reference: Wispr Flow's popout (Samuel, 2026-09-13, two screenshots). Clone the
layout; swap only colours/fonts to Dopl tokens (`docs/DESIGN-SYSTEM.md`).
Builds on `4816e7bc` (frameless popout, Dopl mark + name, badge/expand/close).

## Samuel, verbatim

> "There are tabs, and the active tab is underlined. It's a fixed size, and it does
> not get cut off. You see there's a little X button, so you can see I can add a
> new tab, stuff like that. Also, notice that it's a white panel that's inset now
> on a darker background. … make this agent tabbable, meaning if I have an agent
> popout window open already and I go to another agent and click "Open window," it
> just adds another tab to this. … everything that's currently in the popout agent
> window needs to be moved. That window currently needs to be condensed to the
> right and under a little bit so that we can add that gray background. It should
> be the same color that we have on our current site. … We're moving the logo out
> to the top left. … on the left, you see that there is this collapsible side
> panel … for this, I want to display "Other agents" … It should just be the name
> of the agent, and then under that, it should show "Idle", "Thinking", or "Not
> idle", like "Waiting", stuff like that, instead of the timestamp. … Don't change
> the current window size. … Also remove this line from it that says "Permissions
> applied to this agent from its next decision". Also, leave the context tokens and
> the tools, like those dropdowns, for now."

## Checklist (confirm item-by-item in DONE)

1. **One popout window, many tabs.** `main/agent-window.js`: "Open window" on a
   second agent while the popout is open ADDS A TAB (IPC to the existing
   renderer) instead of a second `BrowserWindow`; opening an agent already
   tabbed focuses its tab. Closing the last tab closes the window. Window size
   and position unchanged (keep today's defaults).
2. **Tab strip** across the top chrome, after the logo: fixed-width tabs
   (`w-[180px]`, name truncated with ellipsis, never cut off), active tab =
   text-primary with a 2px underline (the `SegmentedControl` underline recipe),
   inactive = text-secondary, a small naked × on the active tab (hover on
   others), then a naked "+" that opens the New agent popup for the active
   tab's channel. Right end of the chrome: status badge of the ACTIVE tab,
   expand, close (as today).
3. **Chrome ground + inset panel.** Window background = the site gray by token
   (`--home-panel`, the /home panel ground). The agent surface (everything the
   popout shows today: transcript, composer, context tokens + tools dropdowns)
   moves INTO a white `.bento`-faced panel inset to the RIGHT of the rail and
   BELOW the chrome, `rounded-[14px]`, `gap-3` from the edges.
4. **Logo top-left** of the chrome, outside the panel (24px mark in its rounded
   square, as today), before the tab strip.
5. **Collapsible agents rail** on the left, on the gray: collapsed = icons only
   (a "collapse/expand" toggle at the top, `PanelLeft` glyph), expanded = the
   toggle labelled "Collapse", then a heading "Agents" and one row per RUNNING
   agent visible to the operator across their channels (the same live-agents
   source the composer @-picker uses — `channels/lib/live-agents.ts`): agent
   name, and under it its state — "Idle", "Thinking", "Waiting" (waiting on a
   decision/ask) — never a timestamp. Clicking a row opens/focuses its tab.
   Ended agents are not listed. Rail width collapsed ≈ 56px, expanded ≈ 260px;
   the inset panel takes the rest.
6. **Remove** the line "Permissions applied to this agent from its next
   decision" (grep it; delete the line, not the control under it).
7. **Keep** the context tokens and tools dropdowns exactly where they are.
8. Tests: main (single window, add-tab IPC, focus existing, close-last closes),
   renderer (tab strip order/underline/×/+, active-tab badge, rail rows +
   states + click-to-focus, no permissions line, panel inset classes).
   MUTATION-VERIFY two. Gates: `cd dopl-desktop-app && npm test`;
   `npx vitest run src/features/channels --reporter=dot`;
   `npm test -w @dopl/desktop-ui`; both typechecks; eslint on touched trees
   `--max-warnings 0` (only new); `node scripts/check-doc-refs.mjs`. 500-line cap.
9. `main/` changes → say so; the Desktop Agent restarts Electron. No commit,
   no push, no stash.
