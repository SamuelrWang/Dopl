/** Loading pages, built from the same frame and cards as the real ones so nothing jumps when they land. */
import type { ReactNode } from "react";
import b from "./base.module.css";
import { cx, u } from "./components";
import x from "./extras.module.css";
import d from "./data.module.css";
import out from "./output.module.css";
import p from "./page.module.css";
import tokens from "./tokens.module.css";

export const Bone = ({ w, h = 15, round }: { w: number | string; h?: number; round?: boolean }) => (
  <span className={x.skel} style={{ width: typeof w === "number" ? u(w) : w, height: u(h), borderRadius: round ? "50%" : undefined }} />
);

function Frame({ fit, children }: { fit?: boolean; children: ReactNode }) {
  return (
    <div className={cx(p.root, tokens.scope)} role="status" aria-busy="true" aria-label="Loading">
      <div className={cx(p.scroller, fit && p.scrollerFit)}>
        <div className={cx(p.inner, fit && p.innerFit)}>{children}</div>
      </div>
    </div>
  );
}

function Head({ action = true }: { action?: boolean }) {
  return (
    <div className={b.between}>
      <Bone w={150} h={32} />
      {action && <Bone w={170} h={53.75} />}
    </div>
  );
}

function Stats({ count = 4 }: { count?: number }) {
  return (
    <div className={p.stats}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={b.card}>
          <div className={d.stat}>
            <Bone w={130} />
            <Bone w={95} h={37.5} />
            <Bone w={165} h={12.5} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Filters({ rows = 2 }: { rows?: number }) {
  return (
    <div className={b.card}>
      <div className={b.between}>
        <Bone w={262} h={53.75} />
        <Bone w={360} h={51} />
      </div>
      {rows > 1 && (
        <div className={b.row}>
          {[100, 120, 90, 110, 120].map((w, i) => (
            <Bone key={i} w={w} h={37.5} />
          ))}
        </div>
      )}
    </div>
  );
}

function Rows({ count, lead = true }: { count: number; lead?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={x.skelRow}>
          {lead && <Bone w={44} h={44} round />}
          <span className={b.tight}>
            <Bone w={170 - (i % 3) * 25} />
            <Bone w={100} h={12.5} />
          </span>
          <span className={b.grow} />
          <Bone w={90} h={27.5} />
          <Bone w={70} />
        </div>
      ))}
    </>
  );
}

function TableCard({ rows, lead, head }: { rows: number; lead?: boolean; head?: boolean }) {
  return (
    <div className={cx(b.card, b.flush, out.fill, x.skelHidden)}>
      {head && (
        <div className={cx(b.between, b.padRow)}>
          <Bone w={262} h={53.75} />
          <Bone w={200} h={51} />
        </div>
      )}
      <Rows count={rows} lead={lead} />
    </div>
  );
}

function ItemCard() {
  return (
    <div className={b.card}>
      <div className={b.row}>
        <Bone w={50} h={50} />
        <span className={cx(b.tight, b.grow)}>
          <Bone w={150} h={18} />
          <Bone w={110} h={12.5} />
        </span>
        <Bone w={70} h={27.5} />
      </div>
      <div className={b.row}>
        {[70, 80, 60].map((w, i) => (
          <Bone key={i} w={w} h={27.5} />
        ))}
      </div>
      <Bone w="100%" h={95} />
      <div className={b.between}>
        <Bone w={120} h={27} />
        <Bone w={120} h={43.75} />
      </div>
    </div>
  );
}

function Cards({ count = 3 }: { count?: number }) {
  return (
    <div className={x.skelGrid}>
      {Array.from({ length: count }, (_, i) => (
        <ItemCard key={i} />
      ))}
    </div>
  );
}

function Panel({ children }: { children?: ReactNode }) {
  return (
    <div className={cx(b.card, out.fill, x.skelHidden)}>
      <Bone w={140} h={22} />
      {children ?? <span className={cx(x.skel, x.skelFill)} />}
    </div>
  );
}

const Split = ({ wide, lead, left, right }: { wide?: boolean; lead?: boolean; left: ReactNode; right: ReactNode }) => (
  <div className={cx(out.split, wide && out.splitWide, lead && out.splitEven)}>
    <div className={out.col}>{left}</div>
    <div className={out.col}>{right}</div>
  </div>
);

export const OverviewSkeleton = () => (
  <Frame fit>
    <Head />
    <Stats count={1} />
    <div className={out.fitRows}>
      <Split wide left={<Panel />} right={<Panel />} />
      <div className={out.three}>
        <Panel />
        <Panel />
        <Panel />
      </div>
    </div>
  </Frame>
);
export const UsersSkeleton = () => (
  <Frame fit>
    <Head />
    <Stats />
    <Filters />
    <TableCard rows={9} lead />
  </Frame>
);
export const ActivitySkeleton = () => (
  <Frame fit>
    <Head />
    <Stats />
    <Split wide left={<TableCard rows={10} lead={false} head />} right={<Panel />} />
  </Frame>
);
export const DevicesSkeleton = () => (
  <Frame>
    <Head action={false} />
    <Stats />
    <Filters />
    <Cards count={2} />
  </Frame>
);
export const DeviceSkeleton = () => (
  <Frame>
    <Bone w={260} />
    <Head />
    <Bone w={600} h={51} />
    <Stats />
    <div style={{ height: u(330), display: "flex" }}>
      <Split wide left={<Panel />} right={<Panel />} />
    </div>
  </Frame>
);
export const KeysSkeleton = () => (
  <Frame>
    <Head />
    <Filters rows={1} />
    <Cards />
    <Cards count={1} />
  </Frame>
);
export const WebhooksSkeleton = () => (
  <Frame>
    <Head />
    <Stats />
    <Cards count={2} />
    <TableCard rows={6} lead={false} head />
  </Frame>
);
export const UsageSkeleton = () => (
  <Frame fit>
    <Head />
    <Stats />
    <div className={out.fitRows}>
      <Split wide left={<Panel />} right={<Panel />} />
      <TableCard rows={3} lead={false} head />
    </div>
  </Frame>
);
export const TeamSkeleton = () => (
  <Frame fit>
    <Head />
    <Split lead left={<TableCard rows={6} lead head />} right={<TableCard rows={6} lead={false} />} />
  </Frame>
);
export const IssuesSkeleton = () => (
  <Frame fit>
    <Head action={false} />
    <Split left={<TableCard rows={4} />} right={<Panel />} />
  </Frame>
);
export const PlaygroundSkeleton = () => (
  <Frame fit>
    <Bone w={170} h={32} />
    <Split
      left={
        <Panel>
          <Bone w="100%" h={150} />
          <span className={cx(x.skel, x.skelFill)} />
          <Bone w="100%" h={53.75} />
        </Panel>
      }
      right={
        <Panel>
          <span className={cx(x.skel, x.skelFill)} />
          <Bone w="100%" h={250} />
        </Panel>
      }
    />
  </Frame>
);
export const ConnectSkeleton = () => (
  <Frame>
    <Head action={false} />
    <div style={{ height: u(620), display: "flex" }}>
      <Split left={<Panel />} right={<Panel />} />
    </div>
  </Frame>
);
export const PlaygroundGallerySkeleton = () => (
  <Frame>
    <Bone w={230} h={32} />
    <Cards count={3} />
    <Cards count={3} />
  </Frame>
);
