"use client";

/**
 * One call as a row, a filterable list of them, and the side panel for one call. Activity, a
 * device's Calls tab and a user's Deliveries tab all read these.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { EmptyState } from "@/shared/ui/empty-state";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { SearchPill } from "@/shared/ui/search-pill";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { StatusPill } from "@/shared/ui/status-pill";
import { DEMO_NOW } from "../_data/company";
import { KIND_LABEL, STATUS_LABEL, timelineOf, type Call, type TimelineStep } from "../_data/activity";
import { ownedDevice, userById } from "../_data/users";
import { ALL_LEVELS, HierarchyFilter, matchesHierarchy, type Hierarchy } from "./hierarchy-filter";
import { BASE, Facts, Filter, FactChip, Id, ModelTrail, clock, ms, ov, since } from "./ui";

export function CallStatus({ call }: { call: Call }) {
  const failed = call.status === "failed" || call.status === "retrying" || call.status === "expired";
  return <StatusPill tone={failed ? "attention" : "neutral"}>{STATUS_LABEL[call.status]}</StatusPill>;
}

export function CallRow({ call, selected, onOpen, showUser = true }: { call: Call; selected?: boolean; onOpen: () => void; showUser?: boolean }) {
  const user = call.userId ? userById(call.userId) : null;
  const device = call.deviceId ? ownedDevice(call.deviceId) : null;
  const meta = [showUser ? user?.name : null, device?.name, call.capability ?? call.webhook?.endpointId ?? null, call.errorCode].filter(Boolean);
  return (
    <li className={cn(ov.row, ov.openRow, "border-t border-border-default first:border-t-0", selected && "bg-menu-item-hover-bg")}>
      <span className="w-22 shrink-0">
        <CallStatus call={call} />
      </span>
      <span className={ov.rowMain}>
        <button type="button" className={cn(ov.open, ov.rowTitle, "block truncate")} onClick={onOpen} aria-label={`Open ${call.id}`}>
          {call.title}
        </button>
        <span className={ov.rowMeta}>{meta.join(" · ") || KIND_LABEL[call.kind]}</span>
      </span>
      <span className={ov.rowAside}>{since(call.at)}</span>
    </li>
  );
}

const TIME_MINS: Record<string, number> = { "1h": 60, "24h": 1440, "7d": 10080, all: Number.POSITIVE_INFINITY };

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "accepted", label: "Accepted" },
  { value: "sent", label: "Sent" },
  { value: "seen", label: "Seen by device" },
  { value: "answered", label: "Answered" },
  { value: "expired", label: "No answer" },
  { value: "failed", label: "Failed" },
];

export function CallList({
  calls,
  selected,
  onOpen,
  showUser = true,
  levels = true,
  kinds = false,
  initial,
}: {
  calls: Call[];
  selected: string | null;
  onOpen: (id: string) => void;
  showUser?: boolean;
  /** Offer the category, integration and model filters. */
  levels?: boolean;
  /** Offer the kind tabs and the user filter (the Activity page). */
  kinds?: boolean;
  initial?: { user?: string; device?: string; status?: string };
}) {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState(initial?.status ?? "all");
  const [hierarchy, setHierarchy] = useState<Hierarchy>(ALL_LEVELS);
  const [capability, setCapability] = useState("all");
  const [user, setUser] = useState(initial?.user ?? "all");
  const [time, setTime] = useState("all");
  const [q, setQ] = useState(initial?.device ?? "");

  const capabilities = useMemo(() => [...new Set(calls.map((c) => c.capability).filter(Boolean))] as string[], [calls]);
  const users = useMemo(() => [...new Set(calls.map((c) => c.userId).filter(Boolean))] as string[], [calls]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls.filter((c) => {
      if (kind !== "all" && c.kind !== kind) return false;
      if (status !== "all" && c.status !== status) return false;
      if (capability !== "all" && c.capability !== capability) return false;
      if (user !== "all" && c.userId !== user) return false;
      if (!matchesHierarchy(c.modelId, hierarchy)) return false;
      if ((Date.parse(DEMO_NOW) - Date.parse(c.at)) / 60_000 > TIME_MINS[time]) return false;
      if (needle) {
        const hay = [c.id, c.requestId, c.deviceId, c.userId, c.title].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [calls, kind, status, capability, user, hierarchy, time, q]);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SearchPill value={q} onChange={setQ} label="Search calls" className="w-56" />
        {kinds && (
          <Filter
            label="Type"
            value={kind}
            options={[{ value: "all", label: "All" }, { value: "delivery", label: "Deliveries" }, { value: "request", label: "Requests" }, { value: "webhook", label: "Webhooks" }]}
            onChange={setKind}
          />
        )}
        <Filter label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        {levels && <HierarchyFilter value={hierarchy} onChange={setHierarchy} />}
        {kinds && (
          <Filter
            label="User"
            value={user}
            options={[{ value: "all", label: "All" }, ...users.map((id) => ({ value: id, label: userById(id)?.name ?? id }))]}
            onChange={setUser}
          />
        )}
        <Filter label="Capability" value={capability} options={[{ value: "all", label: "All" }, ...capabilities.map((c) => ({ value: c, label: c }))]} onChange={setCapability} />
        <Filter
          label="Time"
          value={time}
          options={[{ value: "1h", label: "Last hour" }, { value: "24h", label: "Last 24 hours" }, { value: "7d", label: "Last 7 days" }, { value: "all", label: "All" }]}
          onChange={setTime}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No calls match these filters" />
      ) : (
        <ul className="white-card m-0 flex min-w-0 list-none flex-col px-3">
          {rows.map((c) => (
            <CallRow key={c.id} call={c} selected={c.id === selected} showUser={showUser} onOpen={() => onOpen(c.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function stepDot(step: TimelineStep) {
  if (step.state === "done") return "bg-text-primary";
  if (step.state === "failed") return "bg-warning";
  if (step.state === "skipped") return "bg-text-muted";
  return "bg-surface-raised-4";
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col">
      {steps.map((step, i) => (
        <li key={step.key} className="flex gap-2.5">
          <span className="flex w-2 shrink-0 flex-col items-center pt-1.25">
            <span className={cn("size-2 shrink-0 rounded-full", stepDot(step))} aria-hidden="true" />
            {i < steps.length - 1 && <span className="my-0.5 w-px flex-1 bg-border-default" aria-hidden="true" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col pb-2.5">
            <span className="flex items-center gap-2">
              <span className={cn("text-body font-medium", step.state === "unknowable" ? "text-text-muted" : "text-text-primary")}>{step.label}</span>
              {step.state === "unknowable" && <StatusPill>Unknowable</StatusPill>}
              {step.at !== undefined && step.at !== null && <span className="ml-auto font-mono text-micro text-text-muted">{ms(step.at)}</span>}
            </span>
            {step.detail && <span className="text-caption text-text-muted">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const VERDICT: Record<string, string> = { chosen: "Chosen", skipped: "Skipped", refused: "Refused" };

function Candidates({ call }: { call: Call }) {
  if (call.candidates.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={SECTION_TITLE}>Devices considered</h3>
      <ul className="card-well m-0 flex list-none flex-col px-3">
        {call.candidates.map((c) => {
          const d = ownedDevice(c.deviceId);
          return (
            <li key={c.deviceId} className={ov.row}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>{d?.name ?? c.deviceId}</span>
                <span className="text-caption text-text-muted">{c.reason}</span>
                <Id>{c.deviceId}</Id>
              </span>
              <StatusPill tone={c.verdict === "refused" ? "attention" : "neutral"}>{VERDICT[c.verdict]}</StatusPill>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Attempts({ call }: { call: Call }) {
  if (!call.webhook) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={SECTION_TITLE}>Attempts</h3>
      <ul className="card-well m-0 flex list-none flex-col px-3">
        {call.webhook.attempts.map((a, i) => (
          <li key={i} className={ov.row}>
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{a.status ? `HTTP ${a.status}` : "No response"}</span>
              <span className="text-caption text-text-muted">{a.note}</span>
            </span>
            <span className={ov.rowAside}>{since(a.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The side panel for one call. Stands in `.rail-layout-aside`. */
export function CallPanel({ call, onClose }: { call: Call; onClose: () => void }) {
  const user = call.userId ? userById(call.userId) : null;
  const device = call.deviceId ? ownedDevice(call.deviceId) : null;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-1">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-caption font-medium text-text-muted">{KIND_LABEL[call.kind]}</span>
          <CallStatus call={call} />
          <button type="button" aria-label="Close" onClick={onClose} className={cn(NAKED_ICON_BUTTON, "ml-auto")}>
            <X size={NAKED_ICON} aria-hidden="true" />
          </button>
        </div>
        <p className="text-title font-medium text-text-primary">{call.title}</p>
        <span className="flex items-center gap-1.5">
          <Id>{call.id}</Id>
          <CopyButton text={call.id} size={11} label="Copy id" />
          {call.truncated && <FactChip tone="attention">Truncated to {call.truncated.kept} of {call.truncated.of} lines</FactChip>}
        </span>
      </header>
      <Facts
        cols={2}
        facts={[
          ["When", clock(call.at)],
          [
            "User",
            user ? (
              <Link href={`${BASE}/users/${user.id}`} className="underline-offset-2 hover:underline">
                {user.name}
              </Link>
            ) : (
              "None"
            ),
          ],
          ["Device", device?.name ?? "None"],
          ...(call.capability ? ([["Capability", call.capability]] as [string, string][]) : []),
          ...(call.http ? ([["Key", call.http.key], ["Status", `HTTP ${call.http.status}`]] as [string, string][]) : []),
          ...(call.errorCode ? ([["Error", call.errorCode]] as [string, string][]) : []),
        ]}
      />
      {device && <ModelTrail modelId={device.modelId} />}
      {call.kind === "delivery" && (
        <section className="flex flex-col gap-1.5">
          <h3 className={SECTION_TITLE}>Timeline</h3>
          <Timeline steps={timelineOf(call)} />
        </section>
      )}
      <Candidates call={call} />
      <Attempts call={call} />
      {call.http && (
        <section className="flex flex-col gap-1.5">
          <h3 className={SECTION_TITLE}>Response</h3>
          <pre className="card-well overflow-x-auto px-3 py-2.5 font-mono text-caption leading-relaxed text-text-secondary">
            {JSON.stringify(
              call.errorCode
                ? { error: { code: call.errorCode, retryable: call.errorCode === "rate_limited", request_id: call.id } }
                : { ok: true, request_id: call.id },
              null,
              2
            )}
          </pre>
        </section>
      )}
    </div>
  );
}
