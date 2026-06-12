"use client";

import { RevealGate } from "../reveal";

const NODES = [
  { x: 60, y: 60, label: "Trigger" },
  { x: 230, y: 130, label: "Load knowledge" },
  { x: 90, y: 210, label: "Run skill" },
  { x: 280, y: 270, label: "Ship output" },
];

const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
];

/**
 * Miniature workflow-canvas card: nodes connected by edges that draw
 * themselves in when scrolled into view.
 */
export function WorkflowMock({ className }: { className?: string }) {
  return (
    <RevealGate className={className}>
      {(started) => (
        <div className="relative overflow-hidden rounded-3xl bg-[#12161f] p-7 shadow-[0_24px_60px_-24px_rgba(14,34,64,0.55)] ring-1 ring-white/10">
          <p className="font-semibold text-white/95">Your Workflow</p>
          <svg
            viewBox="0 0 400 330"
            className="mt-4 w-full"
            role="img"
            aria-label="Workflow graph of connected steps"
          >
            <defs>
              <pattern
                id="mk-grid"
                width="28"
                height="28"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1.5" cy="1.5" r="1.5" fill="rgba(255,255,255,0.07)" />
              </pattern>
            </defs>
            <rect width="400" height="330" fill="url(#mk-grid)" rx="16" />
            {EDGES.map(([from, to], i) => {
              const a = NODES[from];
              const b = NODES[to];
              return (
                <path
                  key={i}
                  d={`M ${a.x + 50} ${a.y + 18} C ${a.x + 120} ${a.y + 18}, ${b.x - 60} ${b.y + 18}, ${b.x + 10} ${b.y + 18}`}
                  fill="none"
                  stroke="#4a9eff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className={started ? "mk-edge" : undefined}
                  style={
                    started
                      ? ({ "--mk-delay": `${300 + i * 350}ms` } as React.CSSProperties)
                      : { strokeDasharray: 120, strokeDashoffset: 120 }
                  }
                />
              );
            })}
            {NODES.map((node, i) => (
              <g
                key={node.label}
                className={started ? "mk-pill" : undefined}
                style={
                  {
                    opacity: started ? undefined : 0,
                    "--mk-delay": `${i * 220}ms`,
                    "--mk-pill-from": "0px",
                  } as React.CSSProperties
                }
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width="120"
                  height="36"
                  rx="18"
                  fill="#0b0e14"
                  stroke="rgba(74,158,255,0.5)"
                  strokeWidth="1.5"
                />
                <circle cx={node.x + 20} cy={node.y + 18} r="4" fill="#4a9eff" />
                <text
                  x={node.x + 34}
                  y={node.y + 23}
                  fill="#dce7f8"
                  fontSize="13"
                  fontFamily="var(--font-inter), sans-serif"
                >
                  {node.label}
                </text>
              </g>
            ))}
          </svg>
          <div
            className="pointer-events-none absolute -top-20 -left-20 size-56 rounded-full opacity-25 blur-3xl"
            style={{ background: "#3d7bff" }}
          />
        </div>
      )}
    </RevealGate>
  );
}
