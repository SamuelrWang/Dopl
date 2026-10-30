"use client";

/** What a device did with a call, drawn per capability. A device with no screen still has an output. */
import { ArrowRight, CornerDownLeft, Image as ImageIcon, Pause, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import b from "./base.module.css";
import { cx, ICON } from "./components";
import d from "./data.module.css";
import x from "./output.module.css";
import { Button } from "./ui";
import { Text } from "./ui-page";

export const Stage = ({ children }: { children: ReactNode }) => <div className={x.stage}>{children}</div>;
export const SplitLayout = ({ wide, lead, left, right }: { /** Left takes two thirds. */ wide?: boolean; /** Left takes a little over half. */ lead?: boolean; left: ReactNode; right: ReactNode }) => (
  <div className={cx(x.split, wide && x.splitWide, lead && x.splitEven)}>
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
export const FillCard = ({ flush, children }: { flush?: boolean; children: ReactNode }) => <div className={cx(b.card, x.fill, flush && x.fillFlush)}>{children}</div>;
/** Scrolls inside a FillCard, with any table's header held at the top. */
export const ScrollArea = ({ areaRef, children }: { areaRef?: Ref<HTMLDivElement>; children: ReactNode }) => (
  <div ref={areaRef} className={x.scrollArea}>
    {children}
  </div>
);

/** How many table rows fit a ScrollArea right now, so a page of them never needs to scroll. */
export function useFitRows(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(fallback);
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const measure = () => {
      const row = area.querySelector("tbody tr")?.getBoundingClientRect().height;
      const head = area.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      if (row) setCount(Math.max(3, Math.floor((area.clientHeight - head) / row)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  return { ref, count };
}
export const FillBody = ({ even, children }: { /** Shares the card's height out between its rows. */ even?: boolean; children: ReactNode }) => <div className={cx(x.fillBody, even && x.fillEven)}>{children}</div>;
/** Stacked rows that share a fit page's height equally. */
export const FitRows = ({ children }: { children: ReactNode }) => <div className={x.fitRows}>{children}</div>;
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

/** A setting: its name, where it comes from and what to do, then its value or editor at full width. */
export function RuleRow({ label, children, actions }: { label: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className={x.ruleRow}>
      <Text kind="strong">{label}</Text>
      <div className={x.ruleActions}>{actions}</div>
      <div className={x.ruleValue}>{children}</div>
    </div>
  );
}

/** The black frame: a tab of black on top, a white panel inside it. For the one thing a page leads with. */
export function InkPanel({ title, icon, action, fill, children }: { title: string; icon?: ReactNode; action?: ReactNode; /** Takes its row's height. */ fill?: boolean; children: ReactNode }) {
  return (
    <div className={cx(x.ink, fill && x.fill)}>
      <div className={x.inkHead}>
        {title}
        {icon}
        {action && <span className={x.inkAction}>{action}</span>}
      </div>
      <div className={x.inkBody}>{children}</div>
    </div>
  );
}
export const InkQuote = ({ children }: { children: ReactNode }) => <div className={x.inkQuote}>{children}</div>;
export const InkFoot = ({ children }: { children: ReactNode }) => <div className={x.inkFoot}>{children}</div>;

/** A prompt line: type, then send. */
export function InkPrompt({ value, placeholder, send, onChange, onSend }: { value: string; placeholder: string; send: string; onChange: (next: string) => void; onSend: () => void }) {
  return (
    <div className={x.inkPrompt}>
      <input
        className={x.inkInput}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSend();
        }}
      />
      <button type="button" className={x.inkSend} disabled={!value.trim()} onClick={onSend}>
        {send}
        <CornerDownLeft {...ICON} aria-hidden="true" />
      </button>
    </div>
  );
}

export const ThreeUp = ({ children }: { children: ReactNode }) => <div className={x.three}>{children}</div>;
export const StatStrip = ({ children }: { children: ReactNode }) => <div className={cx(b.card, x.statStrip)}>{children}</div>;

export const AvatarStack = ({ children }: { children: ReactNode }) => <div className={x.stack}>{children}</div>;

/** A row in a list of things to pick from. */
export function PickRow({ selected, dim, onClick, children }: { selected?: boolean; dim?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} className={cx(x.issueRow, selected && x.issueRowOn, dim && x.muted)} onClick={onClick}>
      {children}
    </button>
  );
}
