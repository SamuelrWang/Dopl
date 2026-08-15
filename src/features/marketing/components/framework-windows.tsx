import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  ClaudeMark,
  DoplMark,
  GmailMark,
  HubSpotMark,
  NotionMark,
  SlackMark,
} from "./framework-marks";

/**
 * The four product vignettes that sit inside the white window centred on the
 * Framework banner — one per tab. All of them are STATIC PROPS: no real data,
 * nothing interactive, no links, no screenshots. The tab row in
 * ./framework-section decides which one is mounted.
 *
 * All four share ONE vertical geometry: a column of three 44px items with 22px
 * gaps is exactly 176px, which is the height of every connector viewBox in this
 * file, so y = 22 / 88 / 154 are the item centres in stages 1, 2, 3 AND 4.
 * Change a tile height or a gap and you MUST change the viewBox with it —
 * nothing else keeps the drawn curves on the boxes they point at.
 *
 * They also share ONE box: marketing.css pins .lp-fw-window to the height the
 * "Unify Data" vignette measures, so the glass and the white window never
 * resize between tabs. A vignette that outgrows that box is a bug in the
 * vignette, not a reason to unpin the window.
 *
 * The vendor marks the vignettes are cast with live in ./framework-marks —
 * inline SVG, and enough path data on its own to push this file past the
 * 500-line cap.
 */

/** The three people the object vignettes are cast with. `alt=""` is deliberate:
 *  every avatar sits beside its own name, so a filled alt would make a screen
 *  reader say the name twice. */
type Person = { readonly id: string; readonly name: string };
const PEOPLE: readonly Person[] = [
  { id: "sam", name: "Sam" },
  { id: "anthony", name: "Anthony" },
  { id: "grace", name: "Grace" },
];

function Avatar({ id }: { id: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/img/avatars/${id}.jpg`}
      alt=""
      className="lp-fw-avatar"
      width={30}
      height={30}
      draggable={false}
    />
  );
}

/**
 * The two connector shapes, both on the SAME 72 × 176 grid so a window can pick
 * one without re-deriving anything.
 *
 * CONVERGING (stages 1 and 3): each feed is a single cubic whose control points
 * sit on the same y as its endpoints (23,22 → 23,88 for the top one). That
 * makes the tangent horizontal at BOTH ends, so the outer two ease away from
 * their box and ease back into the merge instead of arriving at an angle — the
 * funnel, rather than three lines meeting in a V. The middle feed is straight
 * because its endpoints are already level. The trunk carries on from the merge
 * to the panel edge.
 *
 * DIVERGING (stage 4) is that shape read backwards: a trunk out of the
 * left-hand card to a split point, then three cubics easing out to the same
 * three row centres.
 *
 * SPLIT (stage 2) is NOT the diverging shape with the trunk taken out. That
 * version kept all three origins on one point (0,88) and read as the 1-to-3
 * split it was supposed to replace — a fan is a fan whether or not you draw its
 * handle. Here each line has its OWN origin on the template's edge, y = 34 / 88
 * / 142, landing on the three row centres y = 22 / 88 / 154. Three separate
 * departures and three separate arrivals: nothing to mistake for a branch.
 *
 * All three are STRAIGHT — two plain diagonal segments and one horizontal. An
 * earlier cut eased the outer two through cubics whose control points sat on
 * their endpoints' own y, to leave and arrive square; over the 12px they travel
 * that only read as a wobble in an otherwise ruled drawing. A stamp is a
 * straight-line operation, so the lines are straight.
 * No joint, because there is nothing to joint. Same 72 × 176 grid, same dashes.
 */
const FUNNEL_PATHS = [
  "M0 22C23 22 23 88 46 88",
  "M0 88H46",
  "M0 154C23 154 23 88 46 88",
  "M46 88H72",
];
const FUNNEL_JOINT = 46;

const FANOUT_PATHS = [
  "M0 88H26",
  "M26 88C49 88 49 22 72 22",
  "M26 88H72",
  "M26 88C49 88 49 154 72 154",
];
const FANOUT_JOINT = 26;

/** Top / middle / bottom, IN THAT ORDER — the stage-2 sequence draws them one
 *  at a time by DOM position (marketing.css › .lp-fw-fan-line:nth-child). */
const SPLIT_PATHS = ["M0 34L72 22", "M0 88H72", "M0 142L72 154"];

/**
 * Decorative — the boxes either side carry the meaning.
 * `preserveAspectRatio="none"` lets the layer squeeze on narrow windows;
 * `vectorEffect` keeps the hairline AND the dash pattern in screen px, so
 * squeezing never stretches or thickens the dashes.
 */
function Connector({
  paths,
  joint,
  className = "lp-fw-funnel",
}: {
  paths: readonly string[];
  joint: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 176"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="#c9c9c9"
        strokeWidth="1"
        strokeDasharray="3 4"
        strokeLinecap="round"
      >
        {paths.map((d) => (
          <path key={d} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <circle cx={joint} cy="88" r="2.5" fill="#c9c9c9" />
    </svg>
  );
}

/**
 * Stage 2's connector. Same grid, same stroke, but each line is its OWN
 * absolutely-stacked layer, because the sequence reveals them at three
 * different moments and a reveal has to clip one line without touching the
 * other two — which a single <svg> cannot do.
 *
 * The clip runs on the wrapping DIV, not on the <path>: `clip-path` on an SVG
 * child resolves against a fill-box that engines have never fully agreed on,
 * while `inset()` on a block box is the oldest, dullest clip there is. It also
 * leaves `vectorEffect` alone, so the dashes stay 1px and unstretched exactly
 * as they do in <Connector>.
 */
function SplitConnector() {
  return (
    <div className="lp-fw-fan" aria-hidden="true">
      {SPLIT_PATHS.map((d) => (
        <div key={d} className="lp-fw-fan-line">
          <svg
            className="lp-fw-fan-svg"
            viewBox="0 0 72 176"
            preserveAspectRatio="none"
            focusable="false"
          >
            <path
              d={d}
              fill="none"
              stroke="#c9c9c9"
              strokeWidth="1"
              strokeDasharray="3 4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

/**
 * 1 — "Unify Data": three source apps on the left, dashed connectors funnelling
 * into the knowledge base on the right.
 */
const KB_FILES = ["positioning.md", "pricing-notes.md", "call-transcript.md"];

export function KnowledgeWindow() {
  return (
    <div className="lp-fw-win lp-fw-win--unify">
      <div className="lp-fw-sources">
        <div className="lp-fw-source">
          <HubSpotMark />
        </div>
        <div className="lp-fw-source">
          <SlackMark />
        </div>
        <div className="lp-fw-source">
          <NotionMark />
        </div>
      </div>

      <Connector paths={FUNNEL_PATHS} joint={FUNNEL_JOINT} />

      <div className="lp-fw-kb">
        <p className="lp-fw-win-label">Knowledge base</p>
        <h3 className="lp-fw-win-title">Launch Runbook</h3>

        <ul className="lp-fw-files">
          {KB_FILES.map((file) => (
            <li key={file} className="lp-fw-file">
              <FileText
                size={14}
                strokeWidth={1.5}
                className="lp-fw-file-icon"
              />
              {file}
            </li>
          ))}
        </ul>

        <p className="lp-fw-win-foot">3 sources · synced now</p>
      </div>
    </div>
  );
}

/**
 * 2 — "Define Objects": one typed TEMPLATE on the left, three dashed lines, and
 * the three people it is stamped onto on the right. Deliberately NOT stage 1's
 * funnel reversed: unify pulls many into one through a single trunk, define
 * makes three separate stamps, so it gets three separate lines end to end.
 *
 * THIS IS THE ONE VIGNETTE THAT MOVES, and it moves entirely in CSS —
 * @keyframes plus animation-delay, no state, no timers, no library. The whole
 * timeline is written down once, in marketing.css under "stage 2 — the stamp";
 * this file only supplies the boxes it runs on and the order they sit in, since
 * every step is selected by :nth-child.
 *
 * REPLAY is free: ./framework-section keys the tab panel on the stage id, so
 * re-entering "Define Objects" remounts this subtree and every animation starts
 * from zero. Nothing here has to know a tab exists.
 *
 * The sequence ENDS in the static layout rather than in a state of its own —
 * every animated rule resolves to what the base rule already says — so the
 * reduced-motion branch is one `animation: none` plus hiding the expanded panel,
 * and nothing shifts when the last step lands.
 */
type Trait = readonly [name: string, kind: "Knowledge" | "Skill"];

const TEMPLATE_TRAITS: readonly Trait[] = [
  ["Email voice", "Knowledge"],
  ["Sales cycle docs", "Knowledge"],
  ["CRM updating", "Skill"],
];

/** The same three template fields, resolved for ONE person — what the sequence
 *  shows inside the expanded Sam before it condenses back to a compact card.
 *  Order matches TEMPLATE_TRAITS: the rows are the template's, stamped. */
type SamField = readonly [name: string, value: string, kind: Trait[1]];

const SAM_FIELDS: readonly SamField[] = [
  ["Email voice", "sam-voice", "Knowledge"],
  ["Sales cycle docs", "sam-sales-docs", "Knowledge"],
  ["CRM updating", "crm-updating", "Skill"],
];

function TraitRows({ traits }: { traits: readonly Trait[] }) {
  return (
    <ul className="lp-fw-traits">
      {traits.map(([name, kind]) => (
        <li key={name} className="lp-fw-trait">
          <span className="lp-fw-trait-name">{name}</span>
          <span
            className={
              kind === "Skill"
                ? "lp-fw-badge lp-fw-badge--skill"
                : "lp-fw-badge"
            }
          >
            {kind}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ObjectWindow() {
  return (
    <div className="lp-fw-win lp-fw-win--objects">
      <div className="lp-fw-tpl">
        <p className="lp-fw-win-label">Object template</p>
        <h3 className="lp-fw-win-title">Sales Rep</h3>
        <TraitRows traits={TEMPLATE_TRAITS} />
      </div>

      <SplitConnector />

      <div className="lp-fw-stamp">
        <ul className="lp-fw-instances">
          {PEOPLE.map((person) => (
            <li key={person.id} className="lp-fw-inst">
              <Avatar id={person.id} />
              <span className="lp-fw-who">
                <span className="lp-fw-who-name">{person.name}</span>
                <span className="lp-fw-who-role">Sales Rep</span>
              </span>
            </li>
          ))}
        </ul>

        {/* The expanded Sam. It exists ONLY for the sequence: it opens over the
            first row, then condenses onto the compact card underneath it and
            cross-fades out, which is why it is absolutely positioned — a panel
            in the flow would resize the column it is collapsing into.
            `aria-hidden` because the list above already says "Sam", and a
            screen reader must not meet the same instance twice. */}
        <div className="lp-fw-sam" aria-hidden="true">
          <div className="lp-fw-sam-card">
            {/* Sized and padded to .lp-fw-inst's own row, so the last frame of
                the collapse IS the compact card and the cross-fade onto the
                real one has nothing left to move. */}
            <div className="lp-fw-sam-id">
              <Avatar id="sam" />
              <span className="lp-fw-who">
                <span className="lp-fw-who-name">Sam</span>
                <span className="lp-fw-who-role">@sam</span>
              </span>
            </div>

            <ul className="lp-fw-traits lp-fw-sam-list">
              {SAM_FIELDS.map(([name, value, kind]) => (
                <li key={name} className="lp-fw-trait">
                  <span className="lp-fw-trait-name">{name}</span>
                  <span
                    className={
                      kind === "Skill"
                        ? "lp-fw-badge lp-fw-badge--val lp-fw-badge--skill"
                        : "lp-fw-badge lp-fw-badge--val"
                    }
                  >
                    {value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 3 — "Form Relationships": the three Sales Rep instances from stage 2, now as
 * chips, wired into the one Client they all work. The rule under the graph is
 * the labelled edge — kept on its own line rather than floating over the wires,
 * which is the only version of this that survives a 375px window.
 */
const CLIENT_FIELDS: readonly (readonly [string, string])[] = [
  ["Stage", "Evaluating"],
  ["Owner", "Sam"],
];

export function RelationshipWindow() {
  return (
    <div className="lp-fw-win lp-fw-win--rel">
      <div className="lp-fw-rel-row">
        <ul className="lp-fw-chips">
          {PEOPLE.map((person) => (
            <li key={person.id} className="lp-fw-chip">
              <Avatar id={person.id} />
              <span className="lp-fw-chip-name">{person.name}</span>
            </li>
          ))}
        </ul>

        <Connector paths={FUNNEL_PATHS} joint={FUNNEL_JOINT} />

        <div className="lp-fw-client">
          <p className="lp-fw-win-label">Object · Client</p>
          <h3 className="lp-fw-win-title">Acme Corp</h3>

          <dl className="lp-fw-fields">
            {CLIENT_FIELDS.map(([key, value]) => (
              <div key={key} className="lp-fw-field">
                <dt className="lp-fw-field-key">{key}</dt>
                <dd className="lp-fw-field-value">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="lp-fw-rule">
        <span className="lp-fw-badge">Rule</span>
        After call → update owner
      </p>
    </div>
  );
}

/**
 * 4 — "Enable Action": one instance, its context, and Claude turning that into
 * work in the tools the rep already uses. Same tile treatment as stage 1 —
 * Claude gets a full 44px tile, the three destinations get the small one.
 */
const SAM_CONTEXT: readonly Trait[] = [
  ["Email voice", "Knowledge"],
  ["CRM updating", "Skill"],
];

const OUTCOMES: readonly {
  readonly id: string;
  readonly mark: ReactNode;
  readonly text: string;
}[] = [
  { id: "gmail", mark: <GmailMark />, text: "Sent post-conference follow-up" },
  { id: "dopl", mark: <DoplMark />, text: "Updated Launch Runbook KB" },
  { id: "slack", mark: <SlackMark />, text: "Posted pipeline update" },
];

export function AgentWindow() {
  return (
    <div className="lp-fw-win lp-fw-win--action">
      <div className="lp-fw-actor">
        <div className="lp-fw-actor-id">
          <Avatar id="sam" />
          <span className="lp-fw-who">
            <span className="lp-fw-who-name">Sam</span>
            <span className="lp-fw-who-role">Sales Rep</span>
          </span>
        </div>
        <TraitRows traits={SAM_CONTEXT} />
      </div>

      {/* Below 560px the row becomes a column and these two hairlines stand in
          for the horizontal wires, which cannot be rotated by squeezing. */}
      <span className="lp-fw-vwire" aria-hidden="true" />

      <svg
        className="lp-fw-wire"
        viewBox="0 0 34 176"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M0 88H34"
          fill="none"
          stroke="#c9c9c9"
          strokeWidth="1"
          strokeDasharray="3 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="lp-fw-source lp-fw-brain">
        <ClaudeMark />
      </div>

      <Connector
        paths={FANOUT_PATHS}
        joint={FANOUT_JOINT}
        className="lp-fw-funnel lp-fw-funnel--out"
      />

      <span className="lp-fw-vwire" aria-hidden="true" />

      <ul className="lp-fw-outcomes">
        {OUTCOMES.map((outcome) => (
          <li key={outcome.id} className="lp-fw-outcome">
            <span className="lp-fw-source lp-fw-source--sm">
              {outcome.mark}
            </span>
            <span className="lp-fw-outcome-text">{outcome.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
