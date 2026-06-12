import { RIBBON_IN, RIBBON_OUT } from "../constants";

/**
 * The hero's signature animation: scattered grey "context" text drifts
 * along a winding path into a glowing pill, and exits the other side as
 * a clean dark ribbon of completed agent actions.
 *
 * Text motion uses SMIL <animate> on textPath startOffset — zero JS.
 */
export function HeroRibbon() {
  const inText = `${RIBBON_IN.join("   ·   ")}   ·   `.repeat(4);
  const outText = `${RIBBON_OUT.join("   ·   ")}   ·   `.repeat(6);

  return (
    <div aria-hidden className="pointer-events-none select-none">
      <svg
        viewBox="0 0 1440 360"
        fill="none"
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Winding input path: loops in from the left, lands at the pill. */}
          <path
            id="mk-ribbon-in"
            d="M -80 80
               C 120 40, 200 200, 120 240
               C 40 280, 60 120, 240 150
               C 420 180, 480 260, 620 215
               C 660 202, 690 190, 712 182"
          />
          {/* Output path: rises out of the pill toward the right edge. */}
          <path
            id="mk-ribbon-out"
            d="M 728 182
               C 860 160, 980 230, 1120 200
               C 1260 170, 1360 120, 1520 90"
          />
          <radialGradient id="mk-pill-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3d7bff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#3d7bff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Faint trace of the input path so the journey reads at a glance. */}
        <use
          href="#mk-ribbon-in"
          stroke="#5b6573"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeDasharray="3 6"
        />

        {/* Input text drifting toward the pill. */}
        <text
          fontSize="15"
          fill="#5b6573"
          fontFamily="var(--font-inter), sans-serif"
          fontStyle="italic"
        >
          <textPath href="#mk-ribbon-in" startOffset="0%">
            {inText}
            <animate
              attributeName="startOffset"
              from="-60%"
              to="0%"
              dur="16s"
              repeatCount="indefinite"
            />
          </textPath>
        </text>

        {/* Output ribbon: thick dark band carrying clean white text. */}
        <use
          href="#mk-ribbon-out"
          stroke="#10131a"
          strokeWidth="34"
          strokeLinecap="round"
        />
        <text
          fontSize="15"
          fontWeight="600"
          fill="#ffffff"
          fontFamily="var(--font-inter), sans-serif"
        >
          <textPath href="#mk-ribbon-out" startOffset="0%">
            {outText}
            <animate
              attributeName="startOffset"
              from="0%"
              to="-50%"
              dur="14s"
              repeatCount="indefinite"
            />
          </textPath>
        </text>

        {/* The Dopl pill — where mess becomes work. */}
        <circle cx="720" cy="178" r="84" fill="url(#mk-pill-glow)" className="mk-glow" />
        <rect
          x="664"
          y="152"
          width="112"
          height="52"
          rx="26"
          fill="#0b0e14"
          stroke="#4a9eff"
          strokeWidth="1.5"
        />
        {/* Waveform-style node bars inside the pill. */}
        {[684, 698, 712, 726, 740, 754].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={178 - [8, 14, 19, 19, 14, 8][i]}
            width="5"
            height={[8, 14, 19, 19, 14, 8][i] * 2}
            rx="2.5"
            fill="#4a9eff"
          />
        ))}
      </svg>
    </div>
  );
}
