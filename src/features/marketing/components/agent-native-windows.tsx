"use client";

import { Check, FileText, Hash } from "lucide-react";
import type { ReactNode } from "react";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { PersonFace, Sequence, accent, at } from "./ontology-bits";
import {
  AGENTS_SCENE,
  DOPL_MARK,
  IDENTITIES,
  IDENTITY_SCENE,
  KNOWLEDGE_SCENE,
  OPERATOR,
  OWNER_PHOTO,
  SESSION_STATUS_LABEL,
  type IdentityId,
  type SessionStatus,
  type ToolCall,
} from "./agent-native-content";

/**
 * The three Agent native windows. Each one is an agent's MCP log on the LEFT
 * (the prompt it was given, then its Dopl tool calls landing one by one) and,
 * on the RIGHT, the Dopl surface those calls build. Mounted by
 * ./agent-native-section.tsx, which keys each window per tab and writes its
 * `data-play`. Decorative mocks: every root is `aria-hidden`; the tab's own
 * title + blurb are the accessible content.
 *
 * Play contract + helpers: ./ontology-bits.tsx (the Orchestration windows'),
 * so the base rules are the END frame and reduced motion shows it.
 * Words and beats: ./agent-native-content.ts. Styles: ../agent-native.css.
 * ⚠ The shared `.lp-ont-window` pins the height; a window that outgrows it is
 * a bug in the window.
 */

function IdentityFace({ id, d = 22 }: { id: IdentityId; d?: number }) {
  const identity = IDENTITIES[id];
  return <PairedAvatar d={d} photo={OWNER_PHOTO} agentLogo={identity.runtime.logo} color={identity.color} thinFrame />;
}

function RuntimeChip({ id }: { id: IdentityId }) {
  const { runtime } = IDENTITIES[id];
  return (
    <span className="lp-agn-runtime">
      {/* eslint-disable-next-line @next/next/no-img-element -- local asset */}
      <img src={runtime.logo} alt="" draggable={false} />
      {runtime.name}
    </span>
  );
}

/** Spinner while the call runs, a filled tick once it lands. */
function CallTick({ call }: { call: ToolCall }) {
  return (
    <Sequence
      steps={[
        ["running", call.at],
        ["done", call.doneAt],
      ]}
      render={(state) =>
        state === "running" ? (
          <span className="lp-ont-tick lp-ont-tick--working" />
        ) : (
          <span className="lp-ont-tick lp-ont-tick--done">
            <Check size={10} strokeWidth={3} />
          </span>
        )
      }
    />
  );
}

/** The agent doing the work: its prompt, then each MCP call growing in. */
function AgentLog({ prompt, calls }: { prompt: string; calls: readonly ToolCall[] }) {
  const operator = IDENTITIES[OPERATOR.identity];
  const finished = calls[calls.length - 1].doneAt;
  return (
    <div className="lp-agn-log" style={accent(operator.color)}>
      <div className="lp-agn-head">
        <IdentityFace id={OPERATOR.identity} d={24} />
        <span className="lp-agn-head-text">
          <span className="lp-agn-head-name">{operator.name}</span>
          <span className="lp-agn-head-via">{OPERATOR.via}</span>
        </span>
        <Sequence
          className="lp-ont-stack lp-ont-stack--end lp-agn-head-state"
          steps={[
            ["working", 0],
            ["done", finished],
          ]}
          render={(state) => (
            <span className="lp-ont-live">
              <i />
              {state === "working" ? OPERATOR.working : OPERATOR.done}
            </span>
          )}
        />
      </div>

      <div className="lp-ont-msg lp-ont-msg--me lp-agn-prompt lp-ont-rise" style={at(150)}>
        <p className="lp-ont-bubble lp-ont-bubble--me">{prompt}</p>
        <PersonFace id="sam" d={20} />
      </div>

      <div className="lp-agn-calls">
        {calls.map((call, i) => (
          <div key={i} className="lp-ont-grow" style={at(call.at)}>
            <div>
              <div className="lp-agn-call">
                {/* eslint-disable-next-line @next/next/no-img-element -- local asset */}
                <img src={DOPL_MARK} alt="" className="lp-agn-call-mark" draggable={false} />
                <span className="lp-agn-call-text">
                  <code className="lp-agn-call-tool">{call.tool}</code>
                  <code className="lp-agn-call-args">{call.args}</code>
                </span>
                <CallTick call={call} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Window({ log, children }: { log: ReactNode; children: ReactNode }) {
  return (
    <div className="lp-ont-win lp-agn-win" aria-hidden="true">
      {log}
      <div className="lp-agn-surface">{children}</div>
    </div>
  );
}

// ── 1 · Create identities ─────────────────────────────────────────────────

export function IdentitiesWindow() {
  const s = IDENTITY_SCENE;
  return (
    <Window log={<AgentLog prompt={s.prompt} calls={s.calls} />}>
      <p className="lp-ont-win-label">{s.label}</p>
      {s.cards.map((card) => (
        <div key={card.identity} className="lp-agn-card lp-ont-rise" style={at(card.at)}>
          <div className="lp-agn-card-head">
            <IdentityFace id={card.identity} d={26} />
            <span className="lp-agn-card-name">{IDENTITIES[card.identity].name}</span>
            <RuntimeChip id={card.identity} />
          </div>
          <p className="lp-agn-card-role">{card.role}</p>
          <div className="lp-agn-kv">
            <span className="lp-agn-kv-key">{s.instructionsKey}</span>
            <Sequence
              className="lp-ont-stack lp-agn-kv-value"
              steps={
                card.instructionsAt > card.at
                  ? [
                      [s.notSet, card.at],
                      [card.instructions, card.instructionsAt],
                    ]
                  : [[card.instructions, card.at]]
              }
              render={(text) => <span>{text}</span>}
            />
          </div>
        </div>
      ))}
      <p className="lp-ont-win-foot lp-ont-fade" style={at(s.footerAt)}>
        {s.footer}
      </p>
    </Window>
  );
}

// ── 2 · Build knowledge ───────────────────────────────────────────────────

export function KnowledgeWindow() {
  const s = KNOWLEDGE_SCENE;
  return (
    <Window log={<AgentLog prompt={s.prompt} calls={s.calls} />}>
      <div className="lp-ont-rise" style={at(s.titleAt)}>
        <p className="lp-ont-win-label">{s.label}</p>
        <h3 className="lp-ont-win-title">{s.title}</h3>
      </div>
      <ul className="lp-ont-files">
        {s.entries.map((entry) => (
          <li key={entry.name} className="lp-ont-file lp-agn-entry lp-ont-rise" style={at(entry.at)}>
            <FileText size={14} strokeWidth={1.5} className="lp-ont-file-icon" />
            <span className="lp-ont-file-text">
              <span className="lp-ont-file-name">{entry.name}</span>
              <span className="lp-agn-chips">
                {entry.sections.map((section, i) => (
                  <span key={section} className="lp-agn-chip lp-ont-fade" style={at(entry.at + 150 + i * 150)}>
                    ## {section}
                  </span>
                ))}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="lp-ont-win-foot lp-agn-readers">
        <span className="lp-ont-fade" style={at(s.readers[0].at)}>
          {s.readersLabel}
        </span>
        {s.readers.map((r) => (
          <span key={r.identity} className="lp-agn-reader lp-ont-fade" style={at(r.at)}>
            <IdentityFace id={r.identity} d={18} />
            {IDENTITIES[r.identity].name}
          </span>
        ))}
      </p>
    </Window>
  );
}

// ── 3 · Launch and end agents ─────────────────────────────────────────────

/** Live-session count over time, from the sessions' own launch and end steps. */
const LIVE_STEPS: [number, number][] = (() => {
  const edges = AGENTS_SCENE.sessions
    .flatMap((session) => [
      [session.at, 1] as const,
      [session.steps[session.steps.length - 1][1], -1] as const,
    ])
    .sort((a, b) => a[0] - b[0]);
  let live = 0;
  return [[0, 0], ...edges.map(([t, delta]): [number, number] => [(live += delta), t])];
})();

const STATUS_CLASS: Record<SessionStatus, string> = {
  working: "lp-ont-status lp-ont-status--working",
  reported: "lp-ont-status lp-ont-status--done",
  ended: "lp-ont-status",
};

export function AgentsWindow() {
  const s = AGENTS_SCENE;
  return (
    <Window log={<AgentLog prompt={s.prompt} calls={s.calls} />}>
      <div className="lp-ont-rise" style={at(s.channelAt)}>
        <p className="lp-ont-win-label">{s.label}</p>
        <div className="lp-agn-chan">
          <span className="lp-agn-chan-name">
            <Hash size={14} strokeWidth={2} />
            {s.channel}
          </span>
          <Sequence
            className="lp-ont-stack lp-ont-stack--end"
            steps={LIVE_STEPS}
            render={(n) => (
              <span className="lp-ont-live" data-idle={n === 0 || undefined}>
                <i />
                {n} {s.liveSuffix}
              </span>
            )}
          />
        </div>
      </div>
      {s.sessions.map((session) => (
        <div
          key={session.identity}
          className="lp-agn-card lp-ont-rise"
          style={at(session.at)}
        >
          <div className="lp-agn-card-head">
            <IdentityFace id={session.identity} d={26} />
            <span className="lp-agn-card-name">{IDENTITIES[session.identity].name}</span>
            <Sequence
              className="lp-ont-stack lp-ont-stack--end lp-agn-card-status"
              steps={session.steps}
              render={(status) => <span className={STATUS_CLASS[status]}>{SESSION_STATUS_LABEL[status]}</span>}
            />
          </div>
          <Sequence
            className="lp-ont-stack lp-agn-card-role"
            steps={session.output}
            render={(text) => <span>{text}</span>}
          />
        </div>
      ))}
    </Window>
  );
}
