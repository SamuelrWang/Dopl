import { Archive, Bell, BookOpen, Check, ChevronLeft, ChevronRight, Home, Layers, MoreHorizontal, Search, Settings, Users } from "lucide-react";
import b from "./sys-base.module.css";
import f from "./sys-forms.module.css";
import o from "./sys-surfaces.module.css";
import { Tabs } from "./sys-interactive";
import { Card, Face, Section, cx, ICON } from "./sys";

const NAV = [
  { icon: Home, label: "Home" },
  { icon: BookOpen, label: "Stories", count: "128" },
  { icon: Layers, label: "Collections", count: "14" },
  { icon: Users, label: "Contributors", count: "36" },
  { icon: Archive, label: "Archive" },
];
const STEPS = ["Details", "Media", "Review", "Publish"];

export function NavigationGroup() {
  return (
    <Section label="Navigation">
      <div className={cx(b.cols, b.c2r)}>
        <div className={b.col}>
          <Card className={b.spread}>
            <div className={b.stack}>
              <div className={b.row}>
                <span className={cx(b.tile, b.tileBlack)}>
                  <Layers {...ICON} />
                </span>
                <div className={b.tight}>
                  <span className={b.h3}>Jawa</span>
                  <span className={b.smallMuted}>Cultural archive</span>
                </div>
              </div>
              <div className={b.tight}>
                {NAV.map(({ icon: Icon, label, count }, i) => (
                  <div key={label} className={cx(o.navItem, i === 1 && o.navOn)}>
                    <Icon {...ICON} />
                    {label}
                    {count && <span className={o.navCount}>{count}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className={b.stack}>
              <div className={b.line} />
              <div className={o.navItem}>
                <Settings {...ICON} />
                Settings
              </div>
              <div className={b.row}>
                <Face who="terus" />
                <div className={cx(b.tight, b.grow)}>
                  <span className={b.strong}>Terus Adul</span>
                  <span className={b.small}>Project Manager</span>
                </div>
                <MoreHorizontal {...ICON} className={b.iconSoft} />
              </div>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.flush}>
            <div className={cx(b.between, b.padRow)}>
              <div className={o.crumb}>
                Collections
                <ChevronRight {...ICON} className={b.iconSoft} />
                Batik of Surakarta
                <ChevronRight {...ICON} className={b.iconSoft} />
                <span className={o.crumbNow}>Parang Rusak</span>
              </div>
              <div className={b.row}>
                <div className={cx(f.field, b.searchSlim)}>
                  <Search {...ICON} className={b.iconInk} />
                  <span className={cx(f.placeholder, b.grow)}>Search</span>
                  <span className={b.kbd}>⌘ K</span>
                </div>
                <span className={cx(b.btn, b.square)} aria-label="Notifications">
                  <Bell {...ICON} />
                </span>
                <Face who="ada" />
              </div>
            </div>
            <div className={b.line} />
            <div className={b.pad}>
              <Tabs options={["Overview", "Recordings", "Contributors", "Sources", "History"]} start={1} />
            </div>
          </Card>
          <Card className={b.spread}>
            <div className={o.steps}>
              {STEPS.map((step, i) => (
                <div key={step} className={cx(b.row, i < STEPS.length - 1 && b.grow)}>
                  <span className={cx(o.stepDot, i < 2 && o.stepDone, i === 2 && o.stepNow)}>{i < 2 ? <Check size={17.5} strokeWidth={2.2} /> : i + 1}</span>
                  <span className={i <= 2 ? b.strong : b.muted}>{step}</span>
                  {i < STEPS.length - 1 && <span className={cx(o.stepLine, i < 2 && o.stepLineDone)} />}
                </div>
              ))}
            </div>
            <div className={b.line} />
            <div className={b.between}>
              <span className={b.muted}>Showing 21 to 30 of 128 entries</span>
              <div className={o.pager}>
                <span className={cx(o.page, o.pageRing)}>
                  <ChevronLeft {...ICON} />
                </span>
                <span className={o.page}>1</span>
                <span className={o.page}>2</span>
                <span className={cx(o.page, o.pageOn)}>3</span>
                <span className={o.page}>4</span>
                <span className={o.page}>…</span>
                <span className={o.page}>13</span>
                <span className={cx(o.page, o.pageRing)}>
                  <ChevronRight {...ICON} />
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
