import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  ClaudeMark,
  DoplMark,
  GmailMark,
  HubSpotMark,
  NotionMark,
  SlackMark,
} from "./ontology-marks";

/**
 * Four static vignettes, one per Framework tab (mounted by
 * ./ontology-section). No real data, nothing interactive.
 *
 * ⚠ ONE vertical geometry across all four: three 44px items + 22px gaps = 176px
 * = every connector viewBox height here, so y = 22 / 88 / 154 are the item
 * centres in stages 1-4. Change a tile height or gap and you MUST change the
 * viewBox with it, or the curves leave the boxes they point at.
 *
 * ⚠ ONE box: marketing.css pins .lp-ont-window to the "Unify Data" height so the
 * glass never resizes between tabs. A vignette that outgrows it is a bug in the
 * vignette, not a reason to unpin.
 */

/** ⚠ Avatars keep `alt=""`: each sits beside its own name, so a filled alt
 *  makes a screen reader say the name twice. */
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
      className="lp-ont-avatar"
      width={30}
      height={30}
      draggable={false}
    />
  );
}

/**
 * Connector shapes, all on the SAME 72 × 176 grid.
 *
 * CONVERGING (1, 3): control points share their endpoints' y, so tangents are
 * horizontal at BOTH ends — a funnel, not three lines meeting in a V.
 * DIVERGING (4) is that read backwards.
 *
 * ⚠ SPLIT (2) is NOT diverging-minus-trunk. One shared origin (0,88) reads as
 * the 1-to-3 split it replaces. Each line gets its OWN origin, and since the
 * rewrite that origin IS its destination: three PARALLEL horizontals at the row
 * centres y = 22 / 88 / 154. No joint, no tilt. Earlier cuts angled the outer
 * two (cubics, then diagonals) off a 34 / 142 origin; both read as a wobble in
 * an otherwise ruled drawing, and the diagonals read as crooked on the real
 * banner. Parallel-flat is the settled look — do not re-introduce a slope.
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

/** ⚠ Top / middle / bottom, IN THAT ORDER — the stage-2 sequence draws them by
 *  DOM position (marketing.css › .lp-ont-fan-line:nth-child). */
const SPLIT_PATHS = ["M0 22H72", "M0 88H72", "M0 154H72"];

/**
 * Decorative — the boxes either side carry the meaning.
 * `preserveAspectRatio="none"` lets the layer squeeze on narrow windows;
 * `vectorEffect` keeps hairline AND dash pattern in screen px, so squeezing
 * never stretches or thickens the dashes.
 */
function Connector({
  paths,
  joint,
  className = "lp-ont-funnel",
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
 * Stage 2's connector. Each line is its OWN stacked layer: the sequence reveals
 * them at three moments and must clip one without touching the other two,
 * which a single <svg> cannot do.
 *
 * ⚠ Clip runs on the wrapping DIV, not the <path>: `clip-path` on an SVG child
 * resolves against a fill-box engines disagree on, and it would fight
 * `vectorEffect`. `inset()` on a block box keeps dashes 1px and unstretched.
 */
function SplitConnector() {
  return (
    <div className="lp-ont-fan" aria-hidden="true">
      {SPLIT_PATHS.map((d) => (
        <div key={d} className="lp-ont-fan-line">
          <svg
            className="lp-ont-fan-svg"
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

/** 1 — "Unify Data": three sources funnelling into the knowledge base. */
const KB_FILES = ["positioning.md", "pricing-notes.md", "call-transcript.md"];

export function KnowledgeWindow() {
  return (
    <div className="lp-ont-win lp-ont-win--unify">
      <div className="lp-ont-sources">
        <div className="lp-ont-source">
          <HubSpotMark />
        </div>
        <div className="lp-ont-source">
          <SlackMark />
        </div>
        <div className="lp-ont-source">
          <NotionMark />
        </div>
      </div>

      <Connector paths={FUNNEL_PATHS} joint={FUNNEL_JOINT} />

      <div className="lp-ont-kb">
        <p className="lp-ont-win-label">Knowledge base</p>
        <h3 className="lp-ont-win-title">Launch Runbook</h3>

        <ul className="lp-ont-files">
          {KB_FILES.map((file) => (
            <li key={file} className="lp-ont-file">
              <FileText
                size={14}
                strokeWidth={1.5}
                className="lp-ont-file-icon"
              />
              {file}
            </li>
          ))}
        </ul>

        <p className="lp-ont-win-foot">3 sources · synced now</p>
      </div>
    </div>
  );
}

/**
 * 2 — "Define Objects": one typed TEMPLATE stamped onto three people. THE ONE
 * VIGNETTE THAT MOVES, entirely in CSS.
 *
 * ⚠ Timeline lives once in marketing.css under "stage 2 — the stamp"; this
 * file supplies only the boxes AND THEIR ORDER — every step is :nth-child.
 * ⚠ Sequence must END in the static layout, which is what makes the
 * reduced-motion branch one `animation: none` plus hiding the panel.
 */
type Trait = readonly [name: string, kind: "Knowledge" | "Skill"];

const TEMPLATE_TRAITS: readonly Trait[] = [
  ["Email voice", "Knowledge"],
  ["Sales cycle docs", "Knowledge"],
  ["CRM updating", "Skill"],
];

/** Template fields resolved for ONE person, shown in the expanded Sam.
 *  ⚠ Order must match TEMPLATE_TRAITS — same rows, stamped. */
type SamField = readonly [name: string, value: string, kind: Trait[1]];

const SAM_FIELDS: readonly SamField[] = [
  ["Email voice", "sam-voice", "Knowledge"],
  ["Sales cycle docs", "sam-sales-docs", "Knowledge"],
  ["CRM updating", "crm-updating", "Skill"],
];

function TraitRows({ traits }: { traits: readonly Trait[] }) {
  return (
    <ul className="lp-ont-traits">
      {traits.map(([name, kind]) => (
        <li key={name} className="lp-ont-trait">
          <span className="lp-ont-trait-name">{name}</span>
          <span
            className={
              kind === "Skill"
                ? "lp-ont-badge lp-ont-badge--skill"
                : "lp-ont-badge"
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
    <div className="lp-ont-win lp-ont-win--objects">
      <div className="lp-ont-tpl">
        <p className="lp-ont-win-label">Object template</p>
        <h3 className="lp-ont-win-title">Sales Rep</h3>
        <TraitRows traits={TEMPLATE_TRAITS} />
      </div>

      <SplitConnector />

      <div className="lp-ont-stamp">
        <ul className="lp-ont-instances">
          {PEOPLE.map((person) => (
            <li key={person.id} className="lp-ont-inst">
              <Avatar id={person.id} />
              <span className="lp-ont-who">
                <span className="lp-ont-who-name">{person.name}</span>
                <span className="lp-ont-who-role">Sales Rep</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Expanded Sam — exists ONLY for the sequence. ⚠ Absolutely
            positioned: a panel in the flow would resize the column it collapses
            into. `aria-hidden` — the list above already says "Sam". */}
        <div className="lp-ont-sam" aria-hidden="true">
          <div className="lp-ont-sam-card">
            {/* ⚠ Sized/padded to .lp-ont-inst's row so the collapse's last frame
                IS the compact card and the cross-fade has nothing to move. */}
            <div className="lp-ont-sam-id">
              <Avatar id="sam" />
              <span className="lp-ont-who">
                <span className="lp-ont-who-name">Sam</span>
                <span className="lp-ont-who-role">@sam</span>
              </span>
            </div>

            <ul className="lp-ont-traits lp-ont-sam-list">
              {SAM_FIELDS.map(([name, value, kind]) => (
                <li key={name} className="lp-ont-trait">
                  <span className="lp-ont-trait-name">{name}</span>
                  <span
                    className={
                      kind === "Skill"
                        ? "lp-ont-badge lp-ont-badge--val lp-ont-badge--skill"
                        : "lp-ont-badge lp-ont-badge--val"
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
 * 3 — "Form Relationships": stage 2's three reps as chips, wired into one
 * Client. Rule sits on its own line, not floating over the wires — the only
 * version that survives a 375px window.
 */
const CLIENT_FIELDS: readonly (readonly [string, string])[] = [
  ["Stage", "Evaluating"],
  ["Owner", "Sam"],
];

export function RelationshipWindow() {
  return (
    <div className="lp-ont-win lp-ont-win--rel">
      <div className="lp-ont-rel-row">
        <ul className="lp-ont-chips">
          {PEOPLE.map((person) => (
            <li key={person.id} className="lp-ont-chip">
              <Avatar id={person.id} />
              <span className="lp-ont-chip-name">{person.name}</span>
            </li>
          ))}
        </ul>

        <Connector paths={FUNNEL_PATHS} joint={FUNNEL_JOINT} />

        <div className="lp-ont-client">
          <p className="lp-ont-win-label">Object · Client</p>
          <h3 className="lp-ont-win-title">Acme Corp</h3>

          <dl className="lp-ont-fields">
            {CLIENT_FIELDS.map(([key, value]) => (
              <div key={key} className="lp-ont-field">
                <dt className="lp-ont-field-key">{key}</dt>
                <dd className="lp-ont-field-value">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="lp-ont-rule">
        <span className="lp-ont-badge">Rule</span>
        After call → update owner
      </p>
    </div>
  );
}

/**
 * 4 — "Enable Action": one instance + context, Claude turning it into work in
 * the rep's own tools. Claude gets a full 44px tile, destinations the small one.
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
    <div className="lp-ont-win lp-ont-win--action">
      <div className="lp-ont-actor">
        <div className="lp-ont-actor-id">
          <Avatar id="sam" />
          <span className="lp-ont-who">
            <span className="lp-ont-who-name">Sam</span>
            <span className="lp-ont-who-role">Sales Rep</span>
          </span>
        </div>
        <TraitRows traits={SAM_CONTEXT} />
      </div>

      {/* Below 560px the row becomes a column; these hairlines stand in for the
          horizontal wires, which squeezing cannot rotate. */}
      <span className="lp-ont-vwire" aria-hidden="true" />

      <svg
        className="lp-ont-wire"
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

      <div className="lp-ont-source lp-ont-brain">
        <ClaudeMark />
      </div>

      <Connector
        paths={FANOUT_PATHS}
        joint={FANOUT_JOINT}
        className="lp-ont-funnel lp-ont-funnel--out"
      />

      <span className="lp-ont-vwire" aria-hidden="true" />

      <ul className="lp-ont-outcomes">
        {OUTCOMES.map((outcome) => (
          <li key={outcome.id} className="lp-ont-outcome">
            <span className="lp-ont-source lp-ont-source--sm">
              {outcome.mark}
            </span>
            <span className="lp-ont-outcome-text">{outcome.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
