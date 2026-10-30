import { Minus, Monitor, Moon, Plus, Sun } from "lucide-react";
import b from "./sys-base.module.css";
import f from "./sys-forms.module.css";
import { Check, Radios, Segmented, Switch } from "./sys-interactive";
import { Card, Section, cx, ICON } from "./sys";

const THEMES = [
  { label: "Light", icon: Sun },
  { label: "Dark", icon: Moon },
  { label: "System", icon: Monitor },
];
const CHIPS = ["All", "Music", "Textile", "Dance", "Food", "Language"];

export function SelectionGroup() {
  return (
    <Section label="Selection">
      <div className={cx(b.cols, b.c3)}>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Export Options</div>
            <div className={b.stack}>
              <Check label="Include images" on />
              <Check label="Include comments" on />
              <Check label="Include version history" />
              <span className={f.toggleRow}>
                <span className={cx(f.check, f.checkOff)} />
                <span className={b.faint}>Include source files</span>
              </span>
            </div>
            <div className={b.line} />
            <Radios options={["PDF document", "Word document", "Plain text"]} />
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.title}>Appearance</div>
            <div className={b.gridThree}>
              {THEMES.map(({ label, icon: Icon }, i) => (
                <div key={label} className={cx(f.optionTile, i === 0 && f.optionTileOn)}>
                  <Icon {...ICON} className={i === 0 ? b.iconInk : b.iconSoft} />
                  <span className={i === 0 ? b.strong : b.text}>{label}</span>
                </div>
              ))}
            </div>
            <Segmented options={["Day", "Week", "Month", "Year"]} start={1} />
            <div className={cx(b.row, b.wrap)}>
              {CHIPS.map((chip, i) => (
                <span key={chip} className={cx(b.pill, i === 1 && b.pillOn)}>
                  {chip}
                </span>
              ))}
            </div>
          </Card>
        </div>
        <div className={b.col}>
          <Card>
            <div className={b.between}>
              <div className={b.tight}>
                <span className={b.strong}>Offline downloads</span>
                <span className={b.muted}>12 collections, 4.2 GB</span>
              </div>
              <Switch on label="Offline downloads" />
            </div>
            <div className={b.between}>
              <div className={b.tight}>
                <span className={b.strong}>Autoplay recordings</span>
                <span className={b.muted}>Wi-Fi only</span>
              </div>
              <Switch label="Autoplay recordings" />
            </div>
            <div className={b.line} />
            <div className={b.stack}>
              <div className={b.between}>
                <span className={b.strong}>Playback volume</span>
                <span className={cx(b.muted, b.num)}>64%</span>
              </div>
              <div className={f.slider}>
                <div className={f.sliderTrack} />
                <div className={f.sliderFill} style={{ width: "64%" }} />
                <div className={f.sliderKnob} style={{ left: "64%" }} />
              </div>
            </div>
            <div className={b.between}>
              <span className={b.strong}>Copies</span>
              <div className={f.stepper}>
                <span className={f.stepBtn}>
                  <Minus {...ICON} />
                </span>
                <span className={f.stepValue}>3</span>
                <span className={f.stepBtn}>
                  <Plus {...ICON} />
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
