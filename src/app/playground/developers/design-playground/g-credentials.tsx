import { AlertTriangle, Check, ClipboardCopy, KeyRound, RefreshCw } from "lucide-react";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import flow from "../_design/flow.module.css";
import { Segmented } from "../_design/interactive";
import k from "../_design/keys.module.css";
import o from "../_design/surfaces.module.css";
import { Card, Initials, Section, cx, ICON, ICON_SM } from "../_design/components";

const FIGURES = [["Last used", "1m ago"], ["Calls, 7d", "12,480"], ["Created", "55d ago"]];

export function CredentialsGroup() {
  return (
    <Section label="Credentials">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={c.head}>
              <span className={c.glyph}>
                <KeyRound {...ICON} />
              </span>
              <div className={cx(b.tight, b.grow)}>
                <span className={cx(b.h3, c.footText)}>Archive backend</span>
                <span className={k.token}>sk_live_8fQ2••••</span>
              </div>
              <div className={c.headBadges}>
                <span className={cx(b.badge, b.badgeOk)}>
                  <span className={b.dot} />
                  In use
                </span>
              </div>
            </div>
            <div className={c.chips}>
              {["entries.read", "entries.write", "members.read"].map((scope) => (
                <span key={scope} className={cx(b.badge, b.badgeRing)}>
                  {scope}
                </span>
              ))}
            </div>
            <div className={c.well}>
              {FIGURES.map(([label, value]) => (
                <span key={label} className={c.figure}>
                  <span className={b.smallMuted}>{label}</span>
                  <span className={cx(b.h3, b.num, b.nowrap)}>{value}</span>
                </span>
              ))}
            </div>
            <div className={c.foot}>
              <div className={c.footMain}>
                <Initials text="AK" small />
                <span className={cx(b.small, c.footText)}>Ada Komeng</span>
              </div>
              <span className={cx(b.btn, b.sm)}>
                <RefreshCw {...ICON_SM} />
                Rotate
              </span>
              <span className={cx(b.btn, b.sm, b.dangerOutline)}>Revoke</span>
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Copy Your Secret Key</div>
            <div className={cx(b.well, k.secret)}>
              <span className={cx(flow.mono, k.secretValue)}>sk_live_8fQ2-sample-fixture-only</span>
              <span className={cx(b.btn, b.sm)}>
                <ClipboardCopy {...ICON_SM} />
                Copy
              </span>
            </div>
            <div className={cx(b.well, k.secret)}>
              <span className={cx(flow.mono, k.secretValue)}>sk_live_Ld71-sample-fixture-only</span>
              <span className={cx(b.btn, b.sm)}>
                <Check {...ICON_SM} />
                Copied
              </span>
            </div>
            <div className={cx(o.alert, o.alertWarn)}>
              <AlertTriangle {...ICON} />
              Shown once. Store it now.
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card className={b.stageCard}>
            <div className={cx(o.stage, o.stageCenter)}>
              <div className={cx(o.dialog, k.confirm)}>
                <div className={b.tile}>
                  <RefreshCw {...ICON} />
                </div>
                <div className={b.tight}>
                  <span className={b.title}>Rotate Archive backend?</span>
                  <span className={b.muted}>sk_live_8fQ2, used 1m ago, 12,480 calls in 7d</span>
                </div>
                <div className={b.stack}>
                  <span className={b.strong}>Old secret stops working</span>
                  <Segmented options={["Now", "1 hour", "24 hours"]} start={2} />
                </div>
                <div className={b.row}>
                  <span className={cx(b.btn, b.full)}>Cancel</span>
                  <span className={cx(b.btn, b.ink, b.full)}>Rotate key</span>
                </div>
              </div>
            </div>
          </Card>
          <Card className={b.stageCard}>
            <div className={cx(o.stage, o.stageCenter)}>
              <div className={cx(o.dialog, k.confirm)}>
                <div className={cx(b.tile, b.tileDanger)}>
                  <AlertTriangle {...ICON} />
                </div>
                <div className={b.tight}>
                  <span className={b.title}>Revoke Archive backend?</span>
                  <span className={b.muted}>sk_live_8fQ2, used 1m ago, 12,480 calls in 7d</span>
                </div>
                <div className={cx(o.alert, o.alertError)}>
                  <AlertTriangle {...ICON} />
                  In use. Its calls fail at once.
                </div>
                <div className={b.row}>
                  <span className={cx(b.btn, b.full)}>Cancel</span>
                  <span className={cx(b.btn, b.full, k.dangerFlat)}>Revoke key</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
