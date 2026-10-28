/**
 * Vendor marks for ./ontology-windows (Context's sources) and
 * ./multiplayer-visuals, each on its own official grid.
 *
 * ⚠ INLINE SVG deliberately — no network request, no CDN hotlink. Sizing lives
 * in marketing.css (.lp-ont-source-mark + its hosts); nothing here
 * carries a dimension.
 */

/** simple-icons ships Slack as ONE monochrome path; split into the four official
 *  colour pairs (blue TL, green TR, yellow BR, red BL). ⚠ Each pair is bar +
 *  pin — keep pairs together; a bar without its pin is not the mark. */
const SLACK_PATHS: readonly (readonly [string, string])[] = [
  [
    "#36C5F0",
    "M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z",
  ],
  [
    "#2EB67D",
    "M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z",
  ],
  [
    "#ECB22E",
    "M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
  ],
  [
    "#E01E5A",
    "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z",
  ],
];

/** simple-icons `icons/notion.svg`. */
const NOTION_PATH =
  "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z";

/** FIVE pieces on an 88×66 grid, from Wikimedia `Gmail_icon_(2020).svg`. ⚠ Not
 *  the simple-icons glyph — that one is monochrome and reads as generic mail. */
const GMAIL_VIEWBOX = "52 42 88 66";
const GMAIL_PATHS: readonly (readonly [string, string])[] = [
  ["#4285f4", "M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"],
  ["#34a853", "M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"],
  ["#fbbc04", "M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"],
  ["#ea4335", "M72 74V48l24 18 24-18v26L96 92"],
  ["#c5221f", "M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"],
];

export function SlackMark() {
  return (
    <svg
      className="lp-ont-source-mark"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Slack"
    >
      {SLACK_PATHS.map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}

export function NotionMark() {
  return (
    <svg
      className="lp-ont-source-mark"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Notion"
    >
      <path fill="#0d0d0d" d={NOTION_PATH} />
    </svg>
  );
}

export function GmailMark() {
  return (
    <svg
      className="lp-ont-source-mark"
      viewBox={GMAIL_VIEWBOX}
      role="img"
      aria-label="Gmail"
    >
      {GMAIL_PATHS.map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}
