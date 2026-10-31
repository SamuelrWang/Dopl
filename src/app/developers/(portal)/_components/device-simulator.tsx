"use client";

/**
 * The mocked device simulator: one session per screen that hosts it, a screen drawn per surface, and
 * the calls it received. Nothing leaves the page. The real one sends through `/api/v1` in test mode,
 * so the screen draws what the adapter would, and a tap or voice reply travels back through the API.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import type { Model, Surface } from "../_data/catalog";
import { ov } from "./ui";

export type SimCallStatus = "queued" | "sent" | "seen" | "answered" | "received" | "refused";

export interface SimCall {
  id: number;
  at: string;
  capability: string;
  status: SimCallStatus;
  detail?: string;
}

export interface SimMessage {
  capability: string;
  lines: string[];
  options?: string[];
  /** The rules refuse it: logged, never drawn. */
  refused?: boolean;
}

export interface SimulatorSession {
  running: boolean;
  screen: { lines: string[]; options: string[] } | null;
  calls: SimCall[];
  start: () => void;
  stop: () => void;
  send: (message: SimMessage) => void;
  /** Log a call that draws nothing (a read or a capture). */
  log: (capability: string, detail?: string) => void;
  tap: (option: string) => void;
  voice: () => void;
}

const QUEUE_MS = 300;
const SEEN_MS = 700;
const clock = () => new Date().toLocaleTimeString("en-US", { hour12: false });

export function useSimulatorSession(): SimulatorSession {
  const [running, setRunning] = useState(false);
  const [screen, setScreen] = useState<SimulatorSession["screen"]>(null);
  const [calls, setCalls] = useState<SimCall[]>([]);
  const nextId = useRef(1);
  const openAsk = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const add = useCallback((capability: string, status: SimCallStatus, detail?: string) => {
    const id = nextId.current++;
    setCalls((c) => [{ id, at: clock(), capability, status, detail }, ...c].slice(0, 8));
    return id;
  }, []);
  const mark = useCallback((id: number, status: SimCallStatus, detail?: string) => {
    setCalls((c) => c.map((call) => (call.id === id ? { ...call, status, detail: detail ?? call.detail } : call)));
  }, []);

  const start = useCallback(() => setRunning(true), []);
  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    openAsk.current = null;
    setRunning(false);
    setScreen(null);
    setCalls([]);
  }, []);

  const send = useCallback(
    (message: SimMessage) => {
      if (message.refused) {
        add(message.capability, "refused", "Not an allowed intent");
        return;
      }
      const id = add(message.capability, "queued");
      timers.current.push(
        setTimeout(() => {
          mark(id, "sent");
          setScreen({ lines: message.lines, options: message.options ?? [] });
          openAsk.current = message.options?.length ? id : null;
        }, QUEUE_MS),
        setTimeout(() => mark(id, "seen"), SEEN_MS)
      );
    },
    [add, mark]
  );

  const log = useCallback((capability: string, detail?: string) => void add(capability, "seen", detail), [add]);

  const tap = useCallback(
    (option: string) => {
      if (openAsk.current !== null) mark(openAsk.current, "answered", option);
      openAsk.current = null;
      setScreen((s) => s && { lines: [...s.lines, `> ${option}`], options: [] });
    },
    [mark]
  );

  const voice = useCallback(() => {
    if (openAsk.current !== null) {
      mark(openAsk.current, "answered", "Voice reply");
      openAsk.current = null;
    }
    add("input.utterance", "received", "Voice reply");
    setScreen((s) => s && { lines: [...s.lines, "> Voice reply"], options: [] });
  }, [add, mark]);

  return { running, screen, calls, start, stop, send, log, tap, voice };
}

/** A device's screen: the lens or the panel. Options are the wearer's tap targets when `onTap` is set. */
export function DeviceScreen({
  surface,
  lines,
  options = [],
  placeholder,
  onTap,
  className,
}: {
  surface: Surface;
  lines: string[];
  options?: string[];
  placeholder?: string;
  onTap?: (option: string) => void;
  className?: string;
}) {
  const dark = surface === "lens";
  const body = lines.length ? (
    lines.map((line, i) => (
      <span key={i} className={dark ? "whitespace-pre" : undefined}>
        {line}
      </span>
    ))
  ) : (
    <span className="opacity-60">{placeholder}</span>
  );
  const choices = options.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const pill = (
          <StatusPill key={o} onDark={dark}>
            {o}
          </StatusPill>
        );
        return onTap ? (
          <button key={o} type="button" aria-label={`Tap ${o}`} className="transition-opacity hover:opacity-70" onClick={() => onTap(o)}>
            {pill}
          </button>
        ) : (
          pill
        );
      })}
    </div>
  );
  if (dark) {
    return (
      <div className={cn("flex min-h-34 flex-col justify-center gap-2 rounded-card bg-surface-cta px-4 py-3.5 font-mono text-small leading-relaxed text-text-on-cta", className)} aria-label="Lens">
        <div className="flex flex-col">{body}</div>
        {choices}
      </div>
    );
  }
  return (
    <div className={cn("white-card flex min-h-34 flex-col gap-1.5 p-3", className)} aria-label="Panel">
      <span className="text-caption font-medium text-text-muted">Larkfield Assist</span>
      <div className="flex flex-col text-body text-text-primary">{body}</div>
      {choices}
    </div>
  );
}

/** Start, stop and the wearer's voice input: the simulator's own controls. */
export function SimulatorControls({ session, model, children }: { session: SimulatorSession; model: Model; children?: ReactNode }) {
  if (!session.running) {
    return (
      <div className="flex items-center justify-between gap-2">
        <StatusPill>Simulator off</StatusPill>
        <button type="button" className={pillButton("outline", "sm")} onClick={session.start}>
          Start simulator
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone="live" dot bare>
        Online
      </StatusPill>
      <span className="flex-1" />
      {children}
      {model.capabilities.includes("input.utterance") && (
        <button type="button" className={pillButton("outline", "sm")} onClick={session.voice}>
          Voice
        </button>
      )}
      <button type="button" className={pillButton("quiet", "sm")} onClick={session.stop}>
        Stop
      </button>
    </div>
  );
}

const STATUS_LABEL: Record<SimCallStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  seen: "Seen by device",
  answered: "Answered",
  received: "Received",
  refused: "Refused",
};

export function SimulatorCalls({ calls }: { calls: SimCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className={cn(ov.rows, "card-well px-3")}>
      {calls.map((c) => (
        <li key={c.id} className={ov.row}>
          <span className={ov.rowMain}>
            <span className={cn(ov.rowTitle, "truncate font-mono text-caption")}>{c.capability}</span>
            <span className={ov.rowMeta}>{c.detail ? `${c.at}, ${c.detail}` : c.at}</span>
          </span>
          <StatusPill tone={c.status === "refused" ? "attention" : c.status === "seen" || c.status === "answered" || c.status === "received" ? "live" : undefined}>{STATUS_LABEL[c.status]}</StatusPill>
        </li>
      ))}
    </ul>
  );
}
