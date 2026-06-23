"use client";

import { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import {
  ONTOLOGY_LAYERS,
  ONTOLOGY_SECTION,
  type OntologyLayer,
  type OntologyLayerId,
} from "../constants";

const N = ONTOLOGY_LAYERS.length;
const GAP = 150; // px of translateZ between stacked slabs
const REVEAL_DROP = 120; // px a slab rises from as it reveals

/** scrollYProgress runs 0→1, so every useTransform input stop must stay within
 *  [0,1] and strictly increase — the WAAPI scroll path rejects out-of-range or
 *  non-monotonic keyframe offsets. */
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Scroll-driven ontology stack — the focal visual of the landing page. A tall
 * section holds a sticky stage: the left copy crossfades through the five layers
 * while the right deck builds a 3D tower of extruded glass slabs (humans on top,
 * actions at the base), connected by flowing data streams. Each slab rises,
 * lights up, and reveals its own layer of content as its slice of the scroll
 * becomes active.
 */
export function OntologyScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const rotateX = useTransform(scrollYProgress, [0, 1], [60, 52]);
  const rotateZ = useTransform(scrollYProgress, [0, 1], [-46, -40]);

  return (
    <section className="onto" ref={ref} style={{ height: `${(N + 1) * 100}vh` }}>
      <div className="onto-sticky">
        <div className="onto-grid dopl-bound">
          <div className="onto-copy">
            <span className="onto-eyebrow">{ONTOLOGY_SECTION.eyebrow}</span>
            <h2 className="onto-heading">{ONTOLOGY_SECTION.heading}</h2>
            <div className="onto-blocks">
              {ONTOLOGY_LAYERS.map((layer, i) => (
                <CopyBlock key={layer.id} layer={layer} index={i} progress={scrollYProgress} />
              ))}
            </div>
          </div>

          <div className="onto-stage">
            <motion.div className="onto-deck" style={{ rotateX, rotateZ }} initial={false}>
              {ONTOLOGY_LAYERS.slice(0, -1).map((layer, i) => (
                <OntologyStream key={`s-${layer.id}`} index={i} progress={scrollYProgress} />
              ))}
              {ONTOLOGY_LAYERS.map((layer, i) => (
                <OntologyPlane key={layer.id} layer={layer} index={i} progress={scrollYProgress} />
              ))}
            </motion.div>
          </div>
        </div>

        <ScrollHint progress={scrollYProgress} />
      </div>
    </section>
  );
}

function CopyBlock({
  layer,
  index,
  progress,
}: {
  layer: OntologyLayer;
  index: number;
  progress: MotionValue<number>;
}) {
  const inP = index / N;
  const outP = (index + 1) / N;
  const opacity = useTransform(
    progress,
    [clamp01(inP - 0.03), clamp01(inP + 0.07), clamp01(outP - 0.07), clamp01(outP + 0.03)],
    [0, 1, 1, 0],
  );
  const y = useTransform(progress, [clamp01(inP), clamp01(outP)], [44, -44]);

  return (
    <motion.div className="onto-block" style={{ opacity, y }} initial={false}>
      <span className="onto-tag">{layer.tag}</span>
      <h3 className="onto-block-title">{layer.title}</h3>
      <p className="onto-block-blurb">{layer.blurb}</p>
    </motion.div>
  );
}

function OntologyPlane({
  layer,
  index,
  progress,
}: {
  layer: OntologyLayer;
  index: number;
  progress: MotionValue<number>;
}) {
  // Humans (index 0) sit highest; actions at the base.
  const slotZ = (N - 1 - index) * GAP;
  const center = (index + 0.5) / N;

  const opacity = useTransform(
    progress,
    [clamp01(index / N - 0.05), clamp01(index / N + 0.08)],
    [0, 1],
  );
  const z = useTransform(
    progress,
    [clamp01(index / N - 0.05), clamp01(index / N + 0.1)],
    [slotZ - REVEAL_DROP, slotZ],
  );
  const scale = useTransform(
    progress,
    [clamp01(center - 0.5 / N), center, clamp01(center + 0.5 / N)],
    [1, 1.04, 1],
  );
  const glow = useTransform(
    progress,
    [clamp01(center - 0.5 / N), center, clamp01(center + 0.5 / N)],
    [0, 1, 0.15],
  );

  return (
    <div className={`onto-plane onto-plane--${layer.id}`}>
      <motion.div className="onto-slab" style={{ z, scale, opacity }} initial={false}>
        <span className="onto-wall onto-wall--front" aria-hidden />
        <span className="onto-wall onto-wall--right" aria-hidden />
        <div className="onto-face">
          <motion.span className="onto-face-glow" style={{ opacity: glow }} initial={false} aria-hidden />
          <span className="onto-face-tag">{layer.tag}</span>
          <PlaneBody id={layer.id} />
        </div>
      </motion.div>
    </div>
  );
}

/** A flowing data stream standing between two stacked slabs. */
function OntologyStream({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(
    progress,
    [clamp01((index + 1) / N - 0.04), clamp01((index + 1) / N + 0.06)],
    [0, 1],
  );
  const midZ = (N - 1 - index) * GAP - GAP / 2;

  return (
    <motion.div
      className="onto-stream"
      style={{ z: midZ, opacity }}
      initial={false}
      aria-hidden
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} className="onto-stream-line" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
    </motion.div>
  );
}

function PlaneBody({ id }: { id: OntologyLayerId }) {
  switch (id) {
    case "humans":
      return (
        <div className="onto-humans">
          <div className="onto-chiprow">
            {["AK", "JM", "RS"].map((p) => (
              <span key={p} className="onto-avatar">{p}</span>
            ))}
            <span className="onto-muted">your team</span>
          </div>
          <div className="onto-command">
            <span className="onto-command-caret" />
            <span className="onto-command-text">Clean up stale leads and re-engage them…</span>
          </div>
        </div>
      );
    case "agents":
      return (
        <div className="onto-agents">
          {[
            { name: "Research agent", status: "running" },
            { name: "Outreach agent", status: "running" },
            { name: "Ops agent", status: "queued" },
          ].map((a) => (
            <div key={a.name} className="onto-agent">
              <span className={`onto-agent-dot onto-agent-dot--${a.status}`} />
              <span className="onto-agent-name">{a.name}</span>
              <span className="onto-agent-bar">
                <span className="onto-agent-fill" />
              </span>
            </div>
          ))}
        </div>
      );
    case "ontology":
      return <OntologyGraph />;
    case "tools":
      return (
        <div className="onto-toolgrid">
          {[
            { name: "HubSpot", c: "#f8761f" },
            { name: "Salesforce", c: "#3b9cd9" },
            { name: "Slack", c: "#cd4b8f" },
            { name: "Gmail", c: "#e25241" },
            { name: "Notion", c: "#c8c8c8" },
            { name: "Stripe", c: "#7c8cf8" },
          ].map((t) => (
            <span key={t.name} className="onto-tool">
              <span className="onto-tool-dot" style={{ background: t.c }} />
              {t.name}
            </span>
          ))}
        </div>
      );
    case "actions":
      return (
        <div className="onto-actions">
          <span className="onto-action-tag">ACTION</span>
          {[
            { main: "1,204 records updated", sub: "Salesforce · contacts" },
            { main: "42 follow-ups sent", sub: "Gmail · sequences" },
            { main: "7 deals advanced", sub: "HubSpot · pipeline" },
          ].map((r) => (
            <div key={r.main} className="onto-action-row">
              <span className="onto-check">✓</span>
              <div className="onto-action-text">
                <span className="onto-action-main">{r.main}</span>
                <span className="onto-muted">{r.sub}</span>
              </div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/** The ontology layer: a small object graph (nodes + relationship edges) with a
 *  floating asset detail card — the model agents reason over. */
function OntologyGraph() {
  const nodes = [
    { label: "Account", x: 8, y: 10 },
    { label: "Contact", x: 10, y: 64 },
    { label: "Deal", x: 45, y: 36, hot: true },
    { label: "Company", x: 74, y: 8 },
    { label: "Invoice", x: 76, y: 62 },
  ];
  const rels = [
    { label: "employs", x: 9, y: 38 },
    { label: "owns", x: 28, y: 20 },
    { label: "with", x: 60, y: 20 },
    { label: "generates", x: 62, y: 52 },
  ];

  return (
    <div className="onto-graph">
      <svg className="onto-graph-lines" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden>
        <g stroke="rgba(160,185,225,0.45)" strokeWidth="0.5" strokeDasharray="1.6 1.6" fill="none">
          <path d="M14 16 L15 64" />
          <path d="M14 16 L46 38" />
          <path d="M16 66 L45 40" />
          <path d="M50 38 L77 13" />
          <path d="M52 40 L78 63" />
          <path d="M79 16 L79 60" />
        </g>
      </svg>
      {nodes.map((n) => (
        <span
          key={n.label}
          className={`onto-gnode${n.hot ? " onto-gnode--hot" : ""}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <span className="onto-gnode-dot" />
          {n.label}
        </span>
      ))}
      {rels.map((r) => (
        <span key={r.label} className="onto-grel" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
          {r.label}
        </span>
      ))}
      <div className="onto-asset">
        <span className="onto-asset-head">ASSET · DEAL №731</span>
        <span className="onto-asset-row"><span>Owner</span><span>J. Simmons</span></span>
        <span className="onto-asset-row"><span>Stage</span><span>Negotiation</span></span>
        <span className="onto-asset-row"><span>Health</span><span className="onto-asset-score">89</span></span>
      </div>
    </div>
  );
}

function ScrollHint({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.08], [1, 0]);
  return (
    <motion.div className="onto-hint" style={{ opacity }} initial={false} aria-hidden>
      <span>Scroll</span>
      <span className="onto-hint-line" />
    </motion.div>
  );
}
