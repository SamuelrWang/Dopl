// STAGING ONLY. The Overview loading frame: the SAME skeleton as the page (summary strip,
// two columns of cards, the channels table, the people/tools pair), with ghost lines where text
// lands, so nothing moves when the reads arrive.
"use client";

function Ghost({ w, h = 10 }: { w: string; h?: number }) {
  return <span className="ove-ghost" style={{ width: w, height: h }} aria-hidden="true" />;
}

function GhostCard({ rows, title = "40%" }: { rows: number; title?: string }) {
  return (
    <div className="white-card ove-card" aria-hidden="true">
      <div className="white-card ove-card-head">
        <Ghost w={title} h={12} />
      </div>
      <div className="ove-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ove-row">
            <Ghost w="22px" h={22} />
            <span className="ove-row-main">
              <Ghost w={`${70 - i * 8}%`} />
              <Ghost w="38%" h={8} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewSkeleton({ preview }: { preview: boolean }) {
  return (
    <div className="ove" aria-busy="true" aria-label="Loading Overview">
      <div className="ove-inner">
        <div className="white-card ove-card ove-strip" aria-hidden="true">
          {Array.from({ length: preview ? 4 : 2 }, (_, i) => (
            <div key={i} className="ove-cell">
              <Ghost w="50%" h={8} />
              <Ghost w="40%" h={18} />
            </div>
          ))}
        </div>
        <div className="ove-grid">
          <div className="ove-col">
            <GhostCard rows={2} />
            {preview && <GhostCard rows={4} />}
            {preview && <GhostCard rows={5} />}
          </div>
          <div className="ove-col">
            <GhostCard rows={3} title="30%" />
            <GhostCard rows={2} title="30%" />
            {preview && <GhostCard rows={5} title="30%" />}
          </div>
        </div>
        <GhostCard rows={5} title="25%" />
        <div className="ove-pair">
          <GhostCard rows={4} />
          <GhostCard rows={4} />
        </div>
      </div>
    </div>
  );
}
