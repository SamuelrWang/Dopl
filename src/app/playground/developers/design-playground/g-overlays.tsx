import { AlertTriangle, ChevronDown, Link2, X } from "lucide-react";
import b from "../_design/base.module.css";
import f from "../_design/forms.module.css";
import o from "../_design/surfaces.module.css";
import { Switch } from "../_design/interactive";
import { Card, Face, Initials, Section, cx, ICON } from "../_design/components";

function Ghost({ rows = 7 }: { rows?: number }) {
  return (
    <div className={o.ghostLines} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={o.ghostLine} style={{ width: `${[72, 94, 58, 88, 66, 92, 48, 80, 70, 90][i % 10]}%` }} />
      ))}
    </div>
  );
}

export function OverlaysGroup() {
  return (
    <Section label="Overlays">
      <div className={cx(b.cols, b.c3r)}>
        <div className={b.col}>
          <Card className={b.stageCard}>
            <div className={cx(o.stage, o.stageCenter)}>
              <Ghost rows={12} />
              <div className={o.dialog}>
                <X {...ICON} className={o.closeCorner} />
                <div className={b.tight}>
                  <span className={b.title}>Share Collection</span>
                  <span className={b.muted}>Batik of Surakarta</span>
                </div>
                <div className={f.floating}>
                  <span className={f.floatLabel}>Invite</span>
                  <div className={cx(f.floatCell, f.floatValue)}>terus@jawa.id</div>
                </div>
                <div className={b.row}>
                  <span className={cx(b.pill, b.pillOn)}>Editor</span>
                  <span className={b.pill}>Viewer</span>
                </div>
                <div className={b.between}>
                  <div className={b.row}>
                    <Face who="ada" />
                    <div className={b.tight}>
                      <span className={b.strong}>Ada Komeng</span>
                      <span className={b.smallMuted}>Owner</span>
                    </div>
                  </div>
                  <span className={cx(b.badge, b.badgeRing)}>You</span>
                </div>
                <div className={b.line} />
                <div className={b.between}>
                  <span className={cx(b.btn, b.sm)}>
                    <Link2 {...ICON} />
                    Copy link
                  </span>
                  <span className={cx(b.btn, b.primary)}>Send Invite</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.stageCard}>
            <div className={cx(o.stage, o.stageCenter)}>
              <Ghost rows={6} />
              <div className={o.dialog}>
                <div className={cx(b.tile, b.tileDanger)}>
                  <AlertTriangle {...ICON} />
                </div>
                <div className={b.tight}>
                  <span className={b.title}>Delete This Entry?</span>
                  <span className={b.muted}>Gamelan Sekaten, 14 recordings</span>
                </div>
                <div className={b.row}>
                  <span className={cx(b.btn, b.full)}>Cancel</span>
                  <span className={cx(b.btn, b.danger, b.full)}>Delete</span>
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className={b.row}>
              <span className={cx(b.btn, b.sm)}>
                Members
                <ChevronDown {...ICON} className={b.iconSoft} />
              </span>
            </div>
            <div className={o.popover}>
              <span className={o.popoverTail} />
              <div className={b.stack3}>
                <Initials text="AK" small ink />
                <Initials text="TA" small />
                <Initials text="AS" small />
                <Initials text="+4" small />
              </div>
              <span className={b.strong}>7 people have access</span>
              <span className={cx(b.btn, b.sm)}>Manage Access</span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.stageCard}>
            <div className={cx(o.stage, o.stageRight)}>
              <Ghost rows={14} />
              <div className={o.sheet}>
                <div className={b.between}>
                  <span className={b.h3}>Filters</span>
                  <X {...ICON} className={b.iconSoft} />
                </div>
                <div className={b.line} />
                <span className={b.faint}>Region</span>
                <div className={cx(b.row, b.wrap)}>
                  <span className={cx(b.pill, b.pillOn)}>Java</span>
                  <span className={b.pill}>Bali</span>
                  <span className={b.pill}>Sumatra</span>
                </div>
                <span className={b.faint}>Period</span>
                <div className={cx(b.row, b.wrap)}>
                  <span className={b.pill}>1900s</span>
                  <span className={cx(b.pill, b.pillOn)}>2000s</span>
                </div>
                <div className={b.between}>
                  <span className={b.text}>Has audio</span>
                  <Switch on label="Has audio" />
                </div>
                <div className={b.between}>
                  <span className={b.text}>Verified</span>
                  <Switch label="Verified" />
                </div>
                <div className={b.grow} />
                <span className={cx(b.btn, b.primary, b.full, b.noGrow)}>Show 24 Results</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
