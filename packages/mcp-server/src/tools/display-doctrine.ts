/**
 * `dopl://doctrine/displays` — the display vocabulary, PULLED (`dopl_get_guide(topic="displays")`;
 * docs/specs/unified-display.md §4.5). The pushed half is `dopl_show`'s description and
 * {@link BLOCKS_PARAM_DOC}; everything longer (limits, the per-surface degradation ladder, two
 * examples) lives here so it costs nothing until an agent designs a display.
 *
 * ⚠ THE APP'S VALIDATOR IS THE TRUTH (`src/features/display/core/normalize.ts`, limits in
 * `core/types.ts › DISPLAY_LIMITS`); this text restates it for agents. Change both together.
 */

export const DISPLAYS_DOCTRINE_URI = "dopl://doctrine/displays";

/** The `blocks` param line, pushed on every connection (≤330 chars, asserted). */
export const BLOCKS_PARAM_DOC =
  "heading{text} | text{content, tone?:muted|strong} | fields{rows:[{label,value}]} | list{items, style?:number} | choice{options:[{label, description?, recommended?:true, why?}]} (one per display) | progress{value 0-1, label?} | table{columns, rows} | divider | spacer. Any block may carry id.";

export const displaysDoctrine = (): string => `DISPLAYS — one format, every device.
A display is a list of blocks. Dopl draws it as a card on desktop and web, and on the lens for glasses; text-only readers get a plain rendering. Design once: every block degrades on its own.

BLOCKS (1-24 per display; unknown keys are refused by name):
- heading{text} one line, <=120 chars.
- text{content, tone?:"muted"|"strong"} <=2000 chars, newlines kept. Glasses hints: lines, brightness 0-4, border.
- fields{rows:[{label,value}]} 1-12 rows; label <=40, value <=200, one line each.
- list{items, style?:"number"} 1-20 items <=200 chars; information only.
- choice{options:[{label, description?, recommended?:true, why?}]} THE ONE ANSWERABLE BLOCK, max one per display; 2-12 options; label <=80, description <=200; why only on the one recommended option.
- progress{value 0-1, label?}. table{columns (2-4), rows (1-10, one cell per column, <=60 chars)}. divider. spacer{lines?:1-4}.
- Any block may carry id (A-Z a-z 0-9 _ -, <=32); default b1, b2, … by position.

A CHOICE MAKES IT A DECISION: the people it tags (mention=, else your operator) answer it in one press; the answer arrives as their message, or back in the call with wait=true (<=200s). An answered decision re-shown with the same display_id is asked again as a new one.
LIVE UPDATE: the same display_id replaces your unanswered display in place (a status that moves).
TARGET: auto (default) the channel, plus your own glasses for a choice when they are online; channel: chat only; glasses: your lens (and the channel if you are in one).

ON GLASSES (576x288 lens) the display degrades in order until it fits: 1 the choice's descriptions and recommendation note, 2 spacers, 3 dividers, 4+ table/fields/list rows halved ("+N more"). Headings are bright, muted text dim; fields and tables become "label: value" / "a · b" lines; the recommended option is marked "(rec)". validate_only=true shows how it lands on each surface without sending.

EXAMPLES
Decision: {"blocks":[{"type":"heading","text":"Ship the migration now?"},{"type":"text","content":"Additive and reversible. CI is green.","tone":"muted"},{"type":"fields","rows":[{"label":"Risk","value":"Low"},{"label":"ETA","value":"10 min"}]},{"type":"choice","options":[{"label":"Ship now","description":"Live in ~10 minutes","recommended":true,"why":"Reversible"},{"label":"Wait for review","description":"Blocked until tomorrow"}]}]}
Live status: {"display_id":"deploy-1","blocks":[{"type":"heading","text":"Deploy 1.38.0"},{"type":"progress","value":0.6,"label":"Build"},{"type":"table","columns":["Job","State"],"rows":[["web","done"],["desktop","running"]]}]}`;
