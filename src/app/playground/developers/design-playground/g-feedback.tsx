import { AlertCircle, AlertTriangle, CheckCircle2, CloudOff, Info, Loader2, Undo2, X } from "lucide-react";
import b from "../_design/base.module.css";
import o from "../_design/surfaces.module.css";
import { Card, Section, cx, ICON } from "../_design/components";

function Ring({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width={87.5} height={87.5} viewBox="0 0 87.5 87.5" fill="none" aria-hidden="true">
      <circle cx={43.75} cy={43.75} r={r} stroke="#d9d9d9" strokeWidth={8.75} />
      <circle cx={43.75} cy={43.75} r={r} stroke="#000000" strokeWidth={8.75} strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 43.75 43.75)" />
      <text x={43.75} y={49.5} textAnchor="middle" fontSize={17.5} fontWeight={600} letterSpacing="-0.03em" fill="#000000">
        {value}%
      </text>
    </svg>
  );
}

export function FeedbackGroup() {
  return (
    <Section label="Feedback">
      <div className={b.stack}>
        <div className={o.banner}>
          <Info {...ICON} />
          <span className={b.grow}>Scheduled maintenance on Saturday, 02:00 to 04:00 WIB</span>
          <span className={o.bannerBtn}>Details</span>
          <X {...ICON} />
        </div>
      </div>
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Toasts</div>
            <div className={o.toast}>
              <CheckCircle2 {...ICON} className={b.iconOkSoft} />
              <div className={cx(b.tight, b.grow)}>
                <span className={b.strong}>Upload complete</span>
                <span className={b.muted}>Recruitment June 2024.pdf</span>
              </div>
              <X {...ICON} className={b.iconSoft} />
            </div>
            <div className={o.toast}>
              <AlertCircle {...ICON} className={b.iconErrorSoft} />
              <div className={cx(b.tight, b.grow)}>
                <span className={b.strong}>Could not save</span>
                <span className={b.muted}>Connection lost</span>
              </div>
              <X {...ICON} className={b.iconSoft} />
            </div>
            <div className={cx(o.toast, o.toastBlack)}>
              <div className={cx(b.grow, b.onInk)}>Entry moved to trash</div>
              <div className={b.row}>
                <Undo2 {...ICON} />
                <span className={b.onInk}>Undo</span>
              </div>
            </div>
          </Card>
          <Card>
            <div className={b.row}>
              <div className={cx(o.skeleton, o.skeletonRound)} style={{ width: 44, height: 44 }} />
              <div className={cx(b.stack, b.grow)}>
                <div className={o.skeleton} style={{ width: "62%", height: 15 }} />
                <div className={o.skeleton} style={{ width: "38%", height: 12.5 }} />
              </div>
              <div className={o.skeleton} style={{ width: 87.5, height: 37.5 }} />
            </div>
            <div className={b.line} />
            <div className={o.skeleton} style={{ height: 112.5 }} />
            <div className={o.skeleton} style={{ width: "86%", height: 15 }} />
            <div className={o.skeleton} style={{ width: "54%", height: 15 }} />
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Alerts</div>
            <div className={cx(o.alert, o.alertInfo)}>
              <Info {...ICON} />
              Your plan renews on November 4
            </div>
            <div className={cx(o.alert, o.alertOk)}>
              <CheckCircle2 {...ICON} />
              All 128 entries synced
            </div>
            <div className={cx(o.alert, o.alertWarn)}>
              <AlertTriangle {...ICON} />
              Storage is 92% full
            </div>
            <div className={cx(o.alert, o.alertError)}>
              <AlertCircle {...ICON} />
              Two files failed to upload
            </div>
          </Card>
          <Card>
            <div className={o.empty}>
              <span className={b.tile}>
                <CloudOff {...ICON} />
              </span>
              <span className={b.h3}>No recordings yet</span>
              <span className={cx(b.btn, b.primary)}>Upload Recording</span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.spread}>
            <div className={b.between}>
              <div className={b.stack}>
                <div className={o.tooltip}>Copied to clipboard</div>
                <span className={cx(b.btn, b.sm)}>Copy link</span>
              </div>
              <Ring value={72} />
              <div className={b.row}>
                <Loader2 size={30} strokeWidth={1.8} className={b.spinner} />
                <span className={b.muted}>Syncing</span>
              </div>
            </div>
            <div className={b.line} />
            {[
              ["Scanning archive", "214 of 480", 44.6],
              ["Transcribing audio", "9 of 14", 64.3],
              ["Indexing sources", "Done", 100],
            ].map(([label, value, pct]) => (
              <div key={label} className={b.stack}>
                <div className={b.between}>
                  <span className={b.strong}>{label}</span>
                  <span className={cx(b.muted, b.num)}>{value}</span>
                </div>
                <div className={o.bar}>
                  <div className={o.barFill} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
            <div className={b.line} />
            <div className={b.between}>
              <div className={b.tight}>
                <span className={b.strong}>Monthly storage</span>
                <span className={b.smallMuted}>18.4 of 20 GB</span>
              </div>
              <span className={cx(b.badge, b.badgeWarn)}>92%</span>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
