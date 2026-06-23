import { DIAGRAM } from "../constants";

/** The dark right-hand panel: a clinician → agent → capabilities → patient
 *  flow, with one capability highlighted and the rest dimmed and masked. */
export function HeroDiagram() {
  return (
    <div className="dopl-diagram">
      <div className="dopl-flow">
        <div className="dopl-node">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="avatar" src="https://randomuser.me/api/portraits/men/32.jpg" alt="" />
          <span className="nlabel">{DIAGRAM.clinician}</span>
        </div>

        <Arrow />

        <div className="dopl-node">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mark" src="/favicons/android-chrome-512x512.png" alt="" />
          <span className="nlabel">{DIAGRAM.agent}</span>
        </div>

        <Arrow />

        <div className="dopl-caps">
          <ul>
            {DIAGRAM.capabilities.map((cap) => (
              <li key={cap} className={cap === DIAGRAM.highlight ? "on" : undefined}>
                {cap}
              </li>
            ))}
          </ul>
        </div>

        <Arrow />

        <div className="dopl-node">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="avatar" src="https://randomuser.me/api/portraits/women/44.jpg" alt="" />
          <span className="nlabel">{DIAGRAM.patient}</span>
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="dopl-arrow" width="34" height="12" viewBox="0 0 34 12" fill="none">
      <path
        d="M0 6h31m0 0-5-5m5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
