/**
 * THE SECTION HEADING TYPE — every `SectionPanel` label, on every page.
 *
 * Samuel, 2026-09-13, after trialling it on /home Overview's "Usage": *"I want
 * to apply this across the pages because this was a UI test, so it should be
 * applied to each of the headers for each section … 'Shared' and 'Personal'
 * should also be applied … Same with the agents page."* It is the agent
 * identity card's name type one rung up (`text-display`) at semibold, primary
 * ink, normal case — no uppercase label strip any more.
 *
 * ⚠ ONE constant, read by `shared/ui/section-panel.tsx › SectionPanel` (so no
 * caller restates it).
 */
export const SECTION_HEADING_TEXT = "text-display font-semibold text-text-primary";
