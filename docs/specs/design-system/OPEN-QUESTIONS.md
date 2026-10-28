RESOLVED 2026-10-27 (Samuel): the current desktop app is the approved design; every open look/copy question here is settled as currently built unless reopened. Bars gain bottom date labels (no y-axis).

# Design system — open questions for Samuel (2026-10-26)

Each: the question, what was chosen, where. Every control named here renders on
`/playground/system`.

## 1. Is the Tab underline dashed?

You described the switcher's selection line as "a dashed line". No dashed face exists in the
product: every switcher draws a SOLID 2px ink rule at the tab's bottom edge. **Chosen:** kept solid,
now one implementation (`src/shared/ui/tab-underline.tsx › TabUnderline`, used by
`SegmentedControl variant="underline"`). If you want it dashed, it is a one-line change there.

## 2. The white 36px pill had two faces

`PAGE_ACTION_BTN_LIGHT` was `.auth-btn-3d-light` (the older raised 3D face) and `WHITE_PILL` was
`.white-card` + `.raise-pill` (the /home header's search and Profile face). **Chosen:** one
`pillButton("white", "lg")` on the /home face. The channel Threads tab's "face toggle" button
(`channels/components/threads-tab.tsx`, `TAB_ACTION_LIGHT`) is the one control whose look moved.

## 3. A rounded-rectangle black button

The workspace join cards (accept invite, desktop handoff, join link) use a 36px black button with
8px corners (`rounded-md`), not a pill. **Chosen:** left as is. Should they become
`pillButton("ink", "lg")`?

## 4. Always-underlined links

Billing, chats and the desktop handoff use inline prose links that are underlined at REST. That
is not the Text link (underline on hover only). **Chosen:** left as is, listed in `AUDIT.md`.
Should they become Text links?

## 5. The doc editor's link colour

Links inside a knowledge document are `text-violet-300` with a hover underline
(`shared/editor/doc-editor.tsx`), off the palette. **Chosen:** untouched. Make them `text-link`
or Text links?

## 6. The tab underline's ends

The agent window's tab rule was square-ended by your ruling ("rounded-full on a 2px bar tapers both
ends"), while `SegmentedControl` and the member header drew rounded ends. **Chosen:** square
everywhere, so /home's header tabs and the profile rail lose the rounded ends.

## 7. Menus (your dictated note on the ontology "Rows" picker)

Read as: (a) one highlight colour for the hovered row and the selected row, the selected one also
showing the ✓; (b) a little spacing so the highlight does not run edge to edge; (c) the ontology
display picker's options without description lines; (d) that picker's trigger without a pill,
just the word and an arrow, with the Text link underline to try it.
**Chosen:** (a) every `MenuItem` row uses `--menu-item-hover-bg` for hovered, focused and
selected (`.menu-row-selected`); it stays `--surface-raised-1`, the faint gray your hover ruling
set, so the selected row is lighter than its old 8% gray. If it reads too faint, the one token
steps to `--surface-raised-2`. (b) rows sit 2px apart inside the card's existing 7px padding.
(c) "Canvas" / "Rows" only. (d) `SelectMenu variant="link"`. The "P2 background … shadow for
areas or touch" part of the note was not clear enough to act on; tell me what you meant.

## 8. Pill sizes beyond sm / md / lg

Two looks needed more than 26 / 30 / 36: a 22px pill (the task detail's Resolve, the Overview's
usage scope) and a content-height pill (an ontology value chip, the desktop rows' action).
**Chosen:** `xs` and `fit` sizes on the same API, and a `quiet` variant (no fill, subtle hairline:
Launch agent, the Threads / Artifacts Open) beside outline / white / ink, so no call site changed
look.
