/**
 * THE AGENT WINDOW'S FRAME GEOMETRY — the numbers the chrome, the rail and the shell must AGREE
 * on (Samuel, 2026-09-13, second pass over the tabbed pop-out).
 *
 * WHY IT IS A FILE AND NOT THREE SETS OF CLASSES. Every ruling in this pass is an EQUALITY between
 * two surfaces that do not import each other:
 *
 *   > *"the shaded area for the currently selected agent, it is not a perfect square. It has a
 *   > longer width than height. It needs to be a perfect square. … increase the size of the Dopl
 *   > logo. It should be the exact same size as that for the selected agent. That kind of needs to
 *   > be normalized."*
 *   > *"Where you see the name of the agent at the top, the tab switcher should start on the left
 *   > side and be aligned with the start of the white panel."*
 *   > *"For the font, I think it should be the smaller one. I like the left side's smaller
 *   > padding."*
 *
 * A logo in `agent-window-chrome.tsx` and a tile in `agent-window-rail.tsx` that are "both 36px"
 * by coincidence are exactly what he rejected: the two drifted because nothing held them equal.
 * **One constant per equality, imported by both sides**, so the next edit cannot move one half.
 *
 * ⚠ TAILWIND UTILITIES, NOT CSS VARIABLES, and deliberately not tokens. These are the WINDOW's own
 * layout arithmetic (a rail width, a tile edge) rather than palette or type — `globals.css` and the
 * SPA's `tokens.css` are held equal by `scripts/check-css-token-drift.ts` and must not grow a
 * one-window geometry entry. The TYPE step below is a token utility, because type always is.
 *
 * ⚠ IT IS A `.ts` FILE WITH NO JSX AND NO REACT IMPORT, so the tests can read the numbers rather
 * than grepping a component's class attribute for a fragment.
 */

/**
 * 🔒 **ONE SQUARE, TWO READERS — the rail's selected-agent tile AND the Dopl mark** (*"It should
 * be the exact same size as that for the selected agent"*).
 *
 * ⚠ **36px IS DERIVED, NOT PICKED.** The collapsed rail is `RAIL_COLLAPSED` (56px) and carries
 * `RAIL_PAD` (10px each side), so the widest a tile can be and still be a full-bleed row of that
 * rail is 56 − 20 = 36. That is why the square is what it is: **the collapsed rail's inner width
 * IS the tile's edge**, which is the only way the shaded area can be square without either
 * inventing a gutter or leaving one.
 * ⚠ **BOTH DIMENSIONS OR NEITHER.** `h-9 w-9` is one string on purpose — a caller that spelled the
 * height at the call site is how a square became 42×36 the first time.
 */
export const TILE = "h-9 w-9";

/** The tile's corner, shared by the mark and the rail's rows so the two read as one family. */
export const TILE_RADIUS = "rounded-[10px]";

/**
 * 🔒 **THE RAIL'S OWN PADDING, AND THE CHROME BORROWS IT** (*"I like the left side's smaller
 * padding"*). One value on both sides is what puts the mark at the same x as the tiles below it —
 * checklist item 4's *"the tab switcher should start on the left side and be aligned with the start
 * of the white panel"* has a second half, which is that the LOGO is aligned with the RAIL.
 * ⚠ It was `pl-2.5 pr-1` — asymmetric, so a "square" row was neither centred nor square.
 */
export const RAIL_PAD = "px-2.5";

/**
 * 🔒 **THE COLLAPSED RAIL'S PADDING IS DELIBERATELY ASYMMETRIC, BECAUSE THE GUTTER IT HAS TO
 * BALANCE IS** (Samuel, 2026-09-15: *"In the collapsed sidebar, there's still more spacing to the
 * right of the individual agent icons. On the left side, I want the right side to have the same
 * amount of distance to the icon as it is from the left side."*).
 *
 * ⚠ **`RAIL_PAD` WAS ALREADY SYMMETRIC (`px-2.5`), SO THE PADDING WAS NEVER WHAT HE WAS LOOKING
 * AT.** What sits to the RIGHT of a collapsed tile is the rail's own padding PLUS {@link FRAME_GAP}
 * before the white panel's edge — 10 + 12 = 22px against 10px on the left. The eye measures a tile
 * against the two things that bound it (the window's edge and the panel's edge), and by that
 * measure the icon was 12px off centre.
 *
 * ⚠ **THE ARITHMETIC, AND IT KEEPS THE RAIL AT 56px SO NOTHING ELSE MOVES.** Window edge → panel
 * edge is `RAIL_COLLAPSED` (56) + `FRAME_GAP` (12) = 68; centring a 36px `TILE` in it wants 16 on
 * each side, so the rail carries `pl-4` (16) and `pr-1` (4) — and 4 + 12 = 16 on the right.
 * **16 + 36 + 4 = 56**: the column width, the frame's grid and therefore the panel's left edge are
 * all untouched, which is the only version of this fix that does not re-open *"the right side just
 * gets completely cut off"*.
 * ⚠ **THE MARK TAKES IT TOO** — the chrome reads it through its `railPad` prop; see that prop.
 * ⚠ **EXPANDED KEEPS `RAIL_PAD`.** Samuel looked at the expanded rail in the same pass and ruled it
 * fine (*"Actually, that looks fine"*); a 140px rail's rows are wide enough that the 12px gap does
 * not read as a lopsided gutter around a 36px mark.
 */
export const RAIL_PAD_COLLAPSED = "pl-4 pr-1";

/** Collapsed: one tile wide plus `RAIL_PAD_COLLAPSED`. ⚠ `w-14` IS 56px — the spec's number,
 *  unchanged, and {@link RAIL_PAD_COLLAPSED} is asymmetric precisely so it stays that way. */
export const RAIL_COLLAPSED = "w-14";

/**
 * 🔒 **EXPANDED IS 2.5× COLLAPSED AND NEVER MORE** (Samuel: *"in the expanded view, the sidebar is
 * just too large. … it should only increase in size to maybe double the size of the collapsed view
 * or maybe 2.5x"*).
 *
 * ⚠ **IT WAS `w-[260px]`, WHICH IS 4.6× AND HALF THE WINDOW.** The window is 510px wide
 * (`main/agent-window.js`), so a 260px rail left the agent's own panel 226px — narrower than the
 * posture row that window's width is a measurement OF. 56 × 2.5 = 140.
 * ⚠ **AND THE ROWS TRUNCATE INSTEAD OF WIDENING THE RAIL.** A name too long for 140px ellipsizes;
 * it does not get a wider rail. Overflow is handled where the overflow is — the same rule
 * `agent-posture.tsx`'s `flex-nowrap` row follows.
 */
export const RAIL_EXPANDED = "w-[140px]";

/** The gap between the rail and the inset panel, and therefore between the mark and the tab strip:
 *  the strip's left edge = rail width + this, which IS the panel's left edge. */
export const FRAME_GAP = "gap-3";

/** The chrome row's height. ⚠ FIXED, and it must stay fixed: it is the one row a frameless window
 *  can be dragged by, and a height that changed with the tile inside it would move the drag band. */
export const CHROME_ROW = "h-[44px]";

/**
 * 🔒 **ONE TYPE RECIPE FOR A TAB LABEL AND A RAIL ROW** (*"For the font, I think it should be the
 * smaller one"*).
 *
 * ⚠ **THE REJECTED CANDIDATE WAS `IDENTITY_NAME_TEXT`** (`agent-identities/components/
 * identity-section.tsx`, `text-title` = 14px) — the face Samuel named for /home's headings on the
 * same day. He ruled it too big HERE: a tab label and a rail row are ROWS, not headings, so this is
 * `text-body` (12.5px, the scale's "row titles" step — `docs/DESIGN-SYSTEM.md` › Type scale).
 *
 * ⚠ **SIZE AND WEIGHT ONLY — THE INK IS STATE AND STAYS AT THE CALL SITE.** An active tab is
 * `text-text-primary` and an idle one `text-text-secondary`; baking either in would make one of the
 * two impossible to express without fighting this constant (the mistake `IDENTITY_NAME_TEXT_LG`'s
 * docblock records at its own call site).
 */
export const AGENT_NAME_TEXT = "text-body font-normal";

/**
 * 🔒 **THE TAB'S LABEL IS THE SAME SIZE AND A HEAVIER WEIGHT** (Samuel, 2026-09-15: *"Looking at
 * the top you can see I want the name of the tab, like 'New Agent', to be bolded."*).
 *
 * ⚠ **THIS NARROWS THE 2026-09-13 "ONE TYPE RECIPE FOR A TAB LABEL AND A RAIL ROW" EQUALITY TO THE
 * SIZE, AND ONLY TO THE SIZE.** `text-body` is still the shared step — the ruling that rejected
 * `IDENTITY_NAME_TEXT`'s 14px face stands — and the rail row keeps {@link AGENT_NAME_TEXT}'s
 * regular weight.
 * ⚠ **A SECOND CONSTANT RATHER THAN `font-semibold` BESIDE `AGENT_NAME_TEXT` AT THE CALL SITE.**
 * Both are `font-weight` utilities, so which one wins is Tailwind's EMIT order and not the class
 * attribute's — the same trap `select-menu.tsx › TRIGGER_FACE` records ("font size/padding live in
 * the variant so a caller's `className` never fights them in Tailwind's emit order").
 * ⚠ **SIZE AND WEIGHT ONLY, NO INK** — for {@link AGENT_NAME_TEXT}'s own reason: an active tab and
 * an idle one are two colours of one recipe.
 */
export const AGENT_TAB_TEXT = "text-body font-semibold";

/**
 * 🔒 **A TAB HUGS ITS LABEL, UP TO THIS** (Samuel, 2026-09-15: *"Right now you see all this blank
 * space between where the name is and where the X is. That is too much blank space. … Make it
 * unfixed so that the tab will only go as long as the name is and the X will just be to the right
 * of that. Of course if the name is super long then you should fix it to a certain width so we
 * don't have too much overflow."*).
 *
 * ⚠ **IT SUPERSEDES THE FIXED `w-[180px]`** that carried the 2026-09-13 reading of *"It's a fixed
 * size, and it does not get cut off"* — the second half of that sentence is what survives, and it
 * is the `truncate` on the label, not the box.
 * ⚠ **A MAX, NOT A WIDTH**: past it the LABEL ellipsizes inside the tab and the × stays on screen,
 * which is the whole of *"we don't have too much overflow"*. 200px is one step over the 180 it
 * replaces, so the longest name that used to fit still fits.
 */
export const TAB_MAX = "max-w-[200px]";

/** The second line of a rail row — the agent's STATE, never a timestamp. One step down the scale. */
export const AGENT_STATE_TEXT = "text-caption text-text-secondary";

/**
 * 🔒 **THE ACTIVE TAB'S UNDERLINE IS THE POPUP FIELD'S UNDERLINE** (Samuel: *"For the top tab the
 * line is too thin. It should be the same thickness as the underline on the ontology page where you
 * see the description. When the dashed line becomes black it should be that thickness."*).
 *
 * ⚠ **THE RECIPE IT NAMES IS `shared/ui/form-dialog.module.css › .line::after`** — the 2px black
 * rule that sweeps in under a popup field, which is the underline every form in the app (the
 * ontology entry's description included) wears. `agent-window-frame.test.ts` READS that stylesheet
 * and fails if its `height` and this class part ever disagree, so "the same thickness" is checked
 * rather than asserted.
 *
 * ⚠ **IT WAS ALREADY `h-[2px]` AND STILL READ AS THINNER, WHICH IS THE HALF THAT WAS ACTUALLY
 * WRONG.** Two things made it: `rounded-full` on a 2px bar tapers both ends, so the rule reads as a
 * hairline at the corners, and `inset-x-2` held it 8px short of the label on each side, so it
 * underlined less than the word it belongs to. `.line::after` has NO radius and runs `left: 0;
 * right: 0` — matching it means matching all three, not just the number.
 */
export const TAB_UNDERLINE_HEIGHT = "h-[2px]";
export const TAB_UNDERLINE = `absolute inset-x-0 bottom-0 ${TAB_UNDERLINE_HEIGHT} bg-text-primary`;

/**
 * THE INSET PANEL'S FACE — the app's `.bento` card at the window's own radius.
 *
 * ⚠ **`.bento` BY NAME, NOT A HAND-ROLLED WHITE BOX**: it is the recipe every inner card in the app
 * wears (`docs/DESIGN-SYSTEM.md`), so this panel and /home's cards cannot drift.
 *
 * 🔒 **`min-w-0 flex-1` IS THE FIX FOR *"the white panel gets completely cut off"*, and it is only
 * half of it.** A flex item's automatic minimum size is its CONTENT's min-content width, so every
 * ancestor between this panel and the window's own edge needs `min-w-0` too — `agent-window-shell.tsx`
 * and `agent-window.tsx` carry the other halves, and `agent-window-frame.test.ts` pins all of them
 * together. With any one missing, expanding the rail does not shrink the panel: it pushes it (and the
 * chrome's right-hand controls with it) out past a root that is `overflow: hidden`, which is exactly
 * what Samuel saw.
 * ⚠ `min-h-0` + `overflow-hidden` are load-bearing for the same reason in the other axis: the
 * transcript inside scrolls, and a flex child without them grows the panel past the window.
 */
export const INSET_PANEL =
  "bento flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px]";
