"use client";

/** What a device did with a call, drawn per capability. A device with no screen still has an output. */
import { ArrowRight, Image as ImageIcon, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import b from "./base.module.css";
import { cx, ICON } from "./components";
import d from "./data.module.css";
import x from "./output.module.css";
import { Button } from "./ui";
import { Text } from "./ui-page";

export const Stage = ({ children }: { children: ReactNode }) => <div className={x.stage}>{children}</div>;
export const SplitLayout = ({ wide, left, right }: { /** Left takes two thirds. */ wide?: boolean; left: ReactNode; right: ReactNode }) => (
  <div className={cx(x.split, wide && x.splitWide)}>
    <div className={x.col}>{left}</div>
    <div className={x.col}>{right}</div>
  </div>
);

export function LensScreen({ lines, children }: { lines: string[]; children?: ReactNode }) {
  return (
    <div className={x.lens} aria-label="Lens">
      <div className={x.lensText}>{lines.join("\n")}</div>
      {children && <div className={x.answers}>{children}</div>}
    </div>
  );
}

export function PanelScreen({ app, lines, children }: { app: string; lines: string[]; children?: ReactNode }) {
  return (
    <div className={x.panel} aria-label="Screen">
      <Text kind="smallMuted">{app}</Text>
      <Text kind="strong">{lines.join(" ")}</Text>
      {children && <div className={x.answers}>{children}</div>}
    </div>
  );
}

const barsOf = (text: string) => Array.from({ length: 44 }, (_, i) => 22 + ((text.charCodeAt(i % Math.max(text.length, 1)) || 60) * (i + 3) * 37) % 78);

/** A card that fills its column, for pages that fit the window. */
export const FillCard = ({ children }: { children: ReactNode }) => <div className={cx(b.card, x.fill)}>{children}</div>;
export const FillBody = ({ children }: { children: ReactNode }) => <div className={x.fillBody}>{children}</div>;
export const DetailsPane = ({ children }: { children: ReactNode }) => <div className={x.details}>{children}</div>;

export function CodeEditor({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <div className={x.editorWrap}>
      <Text kind="strong">{label}</Text>
      <textarea className={x.editor} aria-label={label} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Plays in the browser's own voice: close enough to hear the words and the length. */
export function SpeakerOutput({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    if (playing) return setPlaying(false);
    utterance.current = new SpeechSynthesisUtterance(text);
    utterance.current.onend = () => setPlaying(false);
    synth.speak(utterance.current);
    setPlaying(true);
  };
  const seconds = Math.max(1, Math.round(text.trim().split(/\s+/).length / 2.5));
  return (
    <>
      <div className={cx(x.wave, playing && x.waveOn)} aria-hidden="true">
        {barsOf(text).map((h, i) => (
          <i key={i} className={x.waveBar} style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className={x.transcript}>
        <Text kind="text">{text}</Text>
      </div>
      <Button onClick={toggle}>
        {playing ? <Pause {...ICON} /> : <Play {...ICON} />}
        {playing ? "Stop" : `Play, ${seconds}s`}
      </Button>
    </>
  );
}

/** Pulses in milliseconds, then the gap after each. */
export function HapticOutput({ pattern }: { pattern: { on: number; off: number }[] }) {
  const total = pattern.reduce((n, p) => n + p.on + p.off, 0);
  return (
    <div className={x.pulses} aria-label="Haptic pattern">
      {pattern.map((p, i) => (
        <span key={i} className={b.row}>
          <i className={x.pulse} style={{ width: `calc(${(p.on / total) * 380} * var(--u))` }} />
          <span className={x.pulseGap} style={{ width: `calc(${(p.off / total) * 380} * var(--u))` }} />
        </span>
      ))}
    </div>
  );
}

export function ChangeOutput({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className={x.change}>
      <div className={x.changeTile}>
        <Text kind="smallMuted">Before</Text>
        <Text kind="h3" clip>
          {before}
        </Text>
      </div>
      <ArrowRight {...ICON} aria-hidden="true" />
      <div className={cx(x.changeTile, x.changeOn)}>
        <Text kind="smallMuted">{label}</Text>
        <Text kind="h3" clip>
          {after}
        </Text>
      </div>
    </div>
  );
}

export function ReadOutput({ rows }: { rows: [string, string][] }) {
  return (
    <dl className={cx(x.readWell, d.kv)}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <Text kind="muted" as="dt">
            {label}
          </Text>
          <dd className={d.kvValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CaptureOutput() {
  return (
    <div className={x.photo} role="img" aria-label="Captured photo">
      <ImageIcon {...ICON} />
    </div>
  );
}

export const FieldGrid = ({ children }: { children: ReactNode }) => <div className={x.fieldGrid}>{children}</div>;

/** A label over its control. */
export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={b.stack}>
      <Text kind="muted">{label}</Text>
      {children}
    </div>
  );
}

/** A name on the left, its options on the right: permissions by tier. */
export function TierRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={x.tierRow}>
      <Text kind="muted">{label}</Text>
      <div className={x.answers}>{children}</div>
    </div>
  );
}

export const Swatch = ({ color }: { color: string }) => <span className={x.swatch} style={{ backgroundColor: color }} aria-hidden="true" />;
export const PreviewStage = ({ children }: { children: ReactNode }) => <div className={x.previewStage}>{children}</div>;
