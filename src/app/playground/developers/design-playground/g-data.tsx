import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, FileText, Folder, MoreHorizontal, Music, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button } from "../_design/ui";
import b from "../_design/base.module.css";
import d from "../_design/data.module.css";
import f from "../_design/forms.module.css";
import { Accordion, Check } from "../_design/interactive";
import { Card, Face, Initials, Section, cx, ICON, ICON_SM } from "../_design/components";

const ROWS: { name: string; kind: string; who: "ada" | "terus" | "agus"; owner: string; status: [string, string]; size: string; on?: boolean }[] = [
  { name: "Gamelan Sekaten", kind: "14 recordings", who: "ada", owner: "Ada Komeng", status: ["Published", b.badgeOk], size: "1.2 GB", on: true },
  { name: "Parang Rusak", kind: "32 scans", who: "agus", owner: "Agus lagi sedih", status: ["In review", b.badgeWarn], size: "842 MB", on: true },
  { name: "Wayang Kulit Notes", kind: "8 documents", who: "terus", owner: "Terus Adul", status: ["Draft", b.badge], size: "12.8 MB" },
  { name: "Sekar Jagad", kind: "19 scans", who: "agus", owner: "Agus lagi sedih", status: ["Failed", b.badgeError], size: "406 MB" },
];

const STATS = [
  { label: "Entries", value: "1,284", delta: "12.4%", up: true },
  { label: "Contributors", value: "36", delta: "3 new", up: true },
  { label: "Listening hours", value: "8,120", delta: "6.1%", up: true },
  { label: "Failed uploads", value: "7", delta: "2.3%", up: false },
];
const BARS = [["Mon", 42], ["Tue", 68], ["Wed", 54], ["Thu", 92], ["Fri", 76], ["Sat", 34], ["Sun", 48]] as const;
const LINE = "M0 112 C 40 104 60 84 95 88 S 150 118 190 92 S 250 40 290 52 S 350 66 390 34 S 440 18 470 12";

function Table() {
  return (
    <Card className={b.flush}>
      <div className={cx(b.between, b.padRow)}>
        <div className={b.row}>
          <span className={b.h3}>Entries</span>
          <Badge tone="ink">2 selected</Badge>
        </div>
        <div className={b.row}>
          <Button size="sm">Move</Button>
          <Button size="sm" variant="dangerOutline">Delete</Button>
        </div>
      </div>
      <div className={b.line} />
      <div className={d.table} role="table">
        <div className={cx(d.cell, d.cellHead, d.cellCenter)}>
          <span className={cx(f.check, f.checkOn)}>
            <span className={d.checkDash} />
          </span>
        </div>
        <div className={cx(d.cell, d.cellHead)}>
          Name
          <ArrowDown {...ICON_SM} className={b.iconInk} />
        </div>
        <div className={cx(d.cell, d.cellHead)}>
          Owner
          <ChevronsUpDown {...ICON_SM} className={b.iconSoft} />
        </div>
        <div className={cx(d.cell, d.cellHead)}>Status</div>
        <div className={cx(d.cell, d.cellHead)}>
          Size
          <ChevronsUpDown {...ICON_SM} className={b.iconSoft} />
        </div>
        <div className={cx(d.cell, d.cellHead)}>Updated</div>
        <div className={cx(d.cell, d.cellHead)} />
        {ROWS.flatMap((row, i) => {
          const last = i === ROWS.length - 1 && d.rowLast;
          const on = row.on && d.cellOn;
          return [
            <div key={`${row.name}-c`} className={cx(d.cell, d.cellCenter, on, last)}>
              <Check on={row.on} />
            </div>,
            <div key={`${row.name}-n`} className={cx(d.cell, on, last)}>
              <div className={b.tight}>
                <span className={b.strong}>{row.name}</span>
                <span className={b.smallMuted}>{row.kind}</span>
              </div>
            </div>,
            <div key={`${row.name}-o`} className={cx(d.cell, on, last)}>
              <Face who={row.who} small clip />
              <span className={b.nowrap}>{row.owner}</span>
            </div>,
            <div key={`${row.name}-s`} className={cx(d.cell, on, last)}>
              <span className={cx(b.badge, row.status[1])}>{row.status[0]}</span>
            </div>,
            <div key={`${row.name}-z`} className={cx(d.cell, b.num, on, last)}>
              {row.size}
            </div>,
            <div key={`${row.name}-u`} className={cx(d.cell, on, last)}>{`${i * 3 + 2}h ago`}</div>,
            <div key={`${row.name}-m`} className={cx(d.cell, d.cellCenter, on, last)}>
              <MoreHorizontal {...ICON} className={b.iconSoft} />
            </div>,
          ];
        })}
      </div>
    </Card>
  );
}

export function DataGroupA() {
  return (
    <Section label="Data">
      <Card>
        <div className={d.statGrid}>
          {STATS.map((s) => (
            <div key={s.label} className={d.stat}>
              <span className={b.muted}>{s.label}</span>
              <span className={b.big}>{s.value}</span>
              <span className={cx(d.delta, !s.up && d.deltaDown)}>
                {s.up ? <TrendingUp {...ICON_SM} /> : <TrendingDown {...ICON_SM} />}
                {s.delta}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Table />
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.between}>
              <span className={b.h3}>Uploads</span>
              <Badge tone="ring">This week</Badge>
            </div>
            <div className={d.bars}>
              {BARS.map(([day, h], i) => (
                <div key={day} className={d.barCol}>
                  <div className={cx(d.barRect, i === 3 && d.barRectOn)} style={{ height: `${h}%` }} />
                  <span className={b.smallMuted}>{day}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.between}>
              <div className={b.tight}>
                <span className={b.muted}>Listening hours</span>
                <span className={b.big}>8,120</span>
              </div>
              <span className={d.delta}>
                <ArrowUp {...ICON_SM} />
                6.1%
              </span>
            </div>
            <svg width="100%" viewBox="0 0 473 130" fill="none" aria-hidden="true">
              {[10, 50, 90, 128].map((y) => (
                <path key={y} d={`M0 ${y}H473`} stroke="#ececec" strokeWidth={1.25} />
              ))}
              <path d={LINE} stroke="#000000" strokeWidth={2.5} strokeLinecap="round" />
              <circle cx={290} cy={52} r={6} fill="#ffffff" stroke="#000000" strokeWidth={2.5} />
            </svg>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.between}>
              <span className={b.h3}>Recent</span>
              <div className={b.stack3}>
                <Face who="ada" small clip />
                <Face who="terus" small clip />
                <Face who="agus" small clip />
                <Initials text="+9" small />
              </div>
            </div>
            <div>
              <div className={cx(d.listRow, d.rowLine)}>
                <span className={b.tile}>
                  <Music {...ICON} />
                </span>
                <div className={cx(b.tight, b.grow)}>
                  <span className={b.strong}>Ladrang Wilujeng</span>
                  <span className={b.smallMuted}>Audio, 6:42</span>
                </div>
                <Badge tone="ok" dot>
                  Live
                </Badge>
              </div>
              <div className={cx(d.listRow, d.rowLine)}>
                <span className={b.tile}>
                  <FileText {...ICON} />
                </span>
                <div className={cx(b.tight, b.grow)}>
                  <span className={b.strong}>Serat Centhini, vol. 3</span>
                  <span className={b.smallMuted}>Transcript, 212 pages</span>
                </div>
                <Badge tone="ring">v4</Badge>
              </div>
              <div className={d.listRow}>
                <span className={b.tile}>
                  <Folder {...ICON} />
                </span>
                <div className={cx(b.tight, b.grow)}>
                  <span className={b.strong}>Keraton Yogyakarta</span>
                  <span className={b.smallMuted}>Folder, 48 items</span>
                </div>
                <Badge>Shared</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

export function DataGroupB() {
  return (
    <div className={cx(b.cols, b.c3r)}>
      <div className={b.col}>
        <div className={d.code}>
          <div className={d.codeHead}>
            <span className={b.onInk}>Fetch an entry</span>
            <Copy {...ICON} />
          </div>
          <div className={d.codeBody}>
            <span className={d.codeDim}>{"// GET /v1/entries/gamelan-sekaten\n"}</span>
            <span className={d.codeStrong}>const</span>
            {" entry = "}
            <span className={d.codeStrong}>await</span>
            {" jawa.entries.get({\n  slug: "}
            <span className={d.codeStrong}>{'"gamelan-sekaten"'}</span>
            {",\n  include: ["}
            <span className={d.codeStrong}>{'"recordings"'}</span>
            {", "}
            <span className={d.codeStrong}>{'"sources"'}</span>
            {"],\n});\n\n"}
            <span className={d.codeDim}>{"// 200 OK\n"}</span>
            {"{\n  id: "}
            <span className={d.codeStrong}>{'"ent_8f2a"'}</span>
            {",\n  region: "}
            <span className={d.codeStrong}>{'"Central Java"'}</span>
            {",\n  recordings: [ /* 14 */ ],\n  sources: [ /* 3 */ ],\n}"}
          </div>
        </div>
      </div>
      <div className={b.col}>
        <Card>
          <span className={b.h3}>Entry Details</span>
          <div className={d.kv}>
            {[["Region", "Central Java"], ["Period", "16th century"], ["Language", "Javanese"], ["License", "CC BY-NC 4.0"], ["Curator", "Terus Adul"]].map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <span className={b.muted}>{k}</span>
                <span className={d.kvValue}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <span className={b.h3}>Badges</span>
          <div className={cx(b.row, b.wrap)}>
            <Badge tone="ink">Featured</Badge>
            <Badge>Audio</Badge>
            <Badge tone="ring">v2.4</Badge>
            <Badge tone="ok" dot>
              Verified
            </Badge>
            <Badge tone="warn">Pending</Badge>
            <Badge tone="error">Expired</Badge>
          </div>
        </Card>
      </div>
      <div className={b.col}>
        <Card>
          <span className={b.h3}>History</span>
          <div className={d.timeline}>
            {[
              ["Published to Collections", "Ada Komeng, 2h ago", true],
              ["Approved by review", "Terus Adul, yesterday", false],
              ["14 recordings added", "Agus lagi sedih, Oct 12", false],
            ].map(([t, m, on]) => (
              <div key={t as string} className={d.tItem}>
                <div className={d.tRail}>
                  <span className={cx(d.tDot, Boolean(on) && d.tDotOn)} />
                  <span className={d.tLine} />
                </div>
                <div className={b.tight}>
                  <span className={b.strong}>{t}</span>
                  <span className={b.smallMuted}>{m}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <Accordion
            items={[
              { q: "Who can edit an entry?", a: "Owners and editors of its collection." },
              { q: "Which formats are supported?", a: "PDF, DOC, TIFF, WAV and MP3 up to 20 MB." },
              { q: "Can I restore a version?", a: "Yes, from the entry's history." },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
