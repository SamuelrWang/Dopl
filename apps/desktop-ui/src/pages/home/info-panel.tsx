import { useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { Switch } from "@/shared/ui/switch";
import { FIELD_WELL } from "@/shared/ui/wells";
import { ME, type HomeChannel } from "./mock";

const POSTURE = [
  { value: "answer", label: "Answer freely" },
  { value: "ask", label: "Ask before sharing" },
  { value: "draft", label: "Draft only" },
] as const;

type PanelTab = "info" | "agents" | "settings";

/**
 * Home's info panel — ALWAYS OPEN beside the record, on the record's own
 * surface. Three tabs: Info (the person), Agents (the pair working this
 * channel), Settings (per-channel parameters). Local state only; mock like
 * the rest of the surface.
 */
export function InfoPanel({ channel }: { channel: HomeChannel }) {
  const [tab, setTab] = useState<PanelTab>("info");

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border-subtle">
      <div className="px-4 pt-3.5 pb-1">
        <SegmentedControl<PanelTab>
          options={[
            { key: "info", label: "Info" },
            { key: "agents", label: "Agents" },
            { key: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-3">
        {tab === "info" && <InfoTab channel={channel} />}
        {tab === "agents" && <AgentsTab channel={channel} />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </aside>
  );
}

function InfoTab({ channel }: { channel: HomeChannel }) {
  const [about, setAbout] = useState(channel.about);
  const [org = "", role = ""] = channel.context.split(" · ");

  return (
    <>
      <div className="flex items-center gap-3 px-1 pt-1">
        <Avatar
          person={{
            userId: channel.id,
            email: channel.email,
            displayName: channel.name,
            avatarUrl: null,
          }}
          size="md"
        />
        <div className="min-w-0">
          <div className="truncate text-title font-semibold text-text-primary">
            {channel.name}
          </div>
          <div className="truncate text-caption text-text-muted">
            {channel.email}
          </div>
        </div>
      </div>

      {/* The person, as their own detached card. */}
      <section className="bento rounded-[14px] bg-bg-elevated p-3.5">
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={4}
          spellCheck={false}
          className={cn(
            FIELD_WELL,
            "w-full resize-none px-3 py-2 text-small leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          )}
          placeholder="Notes your agent can use here"
        />
        <div className="mt-3 space-y-1.5">
          <DetailRow label="Organization" value={org} />
          <DetailRow label="Role" value={role} />
          <DetailRow label="Connected" value={channel.connected} />
          <DetailRow label="Policy" value={channel.policy} />
        </div>
      </section>
    </>
  );
}

function AgentsTab({ channel }: { channel: HomeChannel }) {
  const responding = channel.agents.yours.status === "Responding";
  return (
    <>
      <AgentCard
        owner={ME.name}
        live={responding}
        status={responding ? "Responding" : "Idle"}
        line={channel.agents.yours.lastRun}
        action={
          // A GHOST agent box — the gray shadow of the slot the next agent
          // fills, doubling as the launch button. Same shape as a real box.
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-inset px-3 py-3 text-small font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
          >
            Launch agent
          </button>
        }
      />
      <AgentCard
        owner={channel.name}
        live={channel.agents.theirs.present}
        status={channel.agents.theirs.present ? "Active now" : "Offline"}
        line={channel.agents.theirs.lastSeen}
      />
    </>
  );
}

/**
 * THE agent-thread card chrome from the workspace transcript
 * (`channels-v2/transcript.tsx`, Samuel 2026-08-19): ink ring + dark header
 * bar, inner panel PURE white with a 0.5 sliver of ink as its border-line.
 * One card per agent, headed by its PRINCIPAL's name.
 */
function AgentCard({
  owner,
  live,
  status,
  line,
  action,
}: {
  owner: string;
  live: boolean;
  status: string;
  line: string;
  action?: ReactNode;
}) {
  return (
    <section className="w-full overflow-hidden rounded-[14px] bg-surface-cta text-left ring-1 ring-surface-cta">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Bot size={13} aria-hidden className="shrink-0 text-text-on-cta" />
        <span className="text-small font-medium text-text-on-cta">{owner}</span>
        <span className="flex-1" />
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            live ? "bg-success" : "bg-text-muted"
          )}
        />
      </div>
      {/* Each raised box inside the frame IS one agent (`.raised-tab` — the
          active-nav-chip elevation). The frame can hold several; the ghost
          launch slot below is where the next one appears. */}
      <div className="m-0.5 mt-0 flex flex-col gap-1.5 rounded-[12px] bg-surface-cta pb-0.5">
        <div className="raised-tab flex flex-col gap-1 rounded-[12px] p-3">
          <span className="text-body font-semibold text-text-primary">
            {status}
          </span>
          <span className="text-caption text-text-muted">{line}</span>
        </div>
        {action}
      </div>
    </section>
  );
}

function SettingsTab() {
  return (
    <div className="space-y-2.5 px-1 pt-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-small text-text-primary">Posture</span>
        <PostureSelect />
      </div>
      <SwitchRow label="Auto-respond" initial />
      <SwitchRow label="Notify every exchange" />
    </div>
  );
}

function PostureSelect() {
  const [posture, setPosture] = useState<string>(POSTURE[1].value);
  return (
    <SelectMenu
      ariaLabel="Agent posture"
      value={posture}
      options={POSTURE}
      onChange={setPosture}
    />
  );
}

function SwitchRow({ label, initial = false }: { label: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-small text-text-primary">{label}</span>
      <Switch checked={on} onChange={setOn} aria-label={label} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-caption text-text-muted">{label}</span>
      <span className="truncate text-small font-medium text-text-primary">
        {value}
      </span>
    </div>
  );
}

