/**
 * `dopl://doctrine/displays` — the display vocabulary, PULLED (`dopl_get_guide(topic="displays")`;
 * docs/specs/unified-display.md §4.5). The pushed half is `dopl_show`'s description and
 * {@link BLOCKS_PARAM_DOC}; everything longer (limits, the per-surface degradation ladder, two
 * examples) lives here so it costs nothing until an agent designs a display.
 *
 * ⚠ THE APP'S VALIDATOR IS THE TRUTH (`src/features/display/core/normalize.ts`, limits in
 * `core/types.ts › DISPLAY_LIMITS`); this text restates it for agents. Change both together.
 */
export declare const DISPLAYS_DOCTRINE_URI = "dopl://doctrine/displays";
/** The `blocks` param line, pushed on every connection (≤330 chars, asserted). */
export declare const BLOCKS_PARAM_DOC = "heading{text} | text{content, tone?:muted|strong} | fields{rows:[{label,value}]} | list{items, style?:number} | choice{options:[{label, description?, recommended?:true, why?}]} (one per display) | progress{value 0-1, label?} | table{columns, rows} | divider | spacer. Any block may carry id.";
export declare const displaysDoctrine: () => string;
