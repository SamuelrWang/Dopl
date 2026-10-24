"use client";

import { Check, FileText, Hash, Plus } from "lucide-react";
import {
  AgentFace,
  ActorFace,
  PersonFace,
  Sequence,
  TypingDots,
  WithMentions,
  accent,
  actorAgent,
  actorName,
  at,
} from "./ontology-bits";
import {
  AGENTS,
  CHANNEL,
  CONTEXT,
  TASKS,
  TASK_STATUS_LABEL,
  type TaskStatus,
} from "./ontology-content";
import { AgentRail } from "./ontology-agent-rail";
import { GmailMark, NotionMark, SlackMark } from "./ontology-marks";
import { CHANNEL_END_MS, THREAD, THREAD_SLOTS } from "./ontology-thread";

/**
 * Three of the four Orchestration windows (the fourth, Command, is
 * ./ontology-command.tsx). Mounted by ./ontology-section.tsx, which keys each
 * one per tab and writes its `data-play`. Decorative mocks — every root is
 * `aria-hidden`; the tab's own title + blurb are the accessible content.
 * Play contract and helpers: ./ontology-bits.tsx. Words: ./ontology-content.ts.
 *
 * ⚠ ONE box: marketing.css pins `.lp-ont-window`'s height so the glass never
 * resizes between tabs. A window that outgrows it is a bug in the window.
 */

// ── 1 · Context ─────────────────────────────────────────────────────────

export function ContextWindow() {
  const c = CONTEXT;
  const writer = AGENTS[c.writer];
  const lastEntry = c.entries[c.entries.length - 1].at;
  return (
    <div className="lp-ont-win" aria-hidden="true">
      <div className="lp-ont-kb">
        <p className="lp-ont-win-label">{c.kbLabel}</p>
        <h3 className="lp-ont-win-title">{c.kbTitle}</h3>

        <div className="lp-ont-writer" style={accent(writer.color)}>
          <AgentFace id={c.writer} d={20} />
          <span className="lp-ont-writer-name">{writer.name}</span>
          <Sequence
            steps={[
              ["writing", 0],
              ["wrote", lastEntry + 400],
            ]}
            render={(v) =>
              v === "writing" ? (
                <span className="lp-ont-writer-state">
                  {c.writing}
                  <TypingDots from={0} length={lastEntry + 400} />
                </span>
              ) : (
                <span className="lp-ont-writer-state">{c.wrote}</span>
              )
            }
          />
        </div>

        <ul className="lp-ont-files">
          {c.entries.map((entry) => (
            <li key={entry.name} className="lp-ont-file lp-ont-rise" style={at(entry.at)}>
              <FileText size={14} strokeWidth={1.5} className="lp-ont-file-icon" />
              <span className="lp-ont-file-text">
                <span className="lp-ont-file-name">{entry.name}</span>
                <span className="lp-ont-file-meta">{entry.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="lp-ont-win-foot lp-ont-srcs">
          {c.sourcesLabel}
          <SlackMark />
          <NotionMark />
          <GmailMark />
        </p>
      </div>

      <span className="lp-ont-link lp-ont-draw" style={at(c.wireAt)}>
        <i />
      </span>

      <div className="lp-ont-client lp-ont-rise" style={at(c.objAt)}>
        <p className="lp-ont-win-label">{c.objLabel}</p>
        <h3 className="lp-ont-win-title">{c.objTitle}</h3>

        <dl className="lp-ont-fields">
          {c.fields.map((f) => (
            <div key={f.key} className="lp-ont-field lp-ont-rise" style={at(f.at)}>
              <dt className="lp-ont-field-key">{f.key}</dt>
              <dd className="lp-ont-field-value">{f.value}</dd>
            </div>
          ))}
          <div className="lp-ont-field">
            <dt className="lp-ont-field-key lp-ont-rise" style={at(c.peopleAt)}>
              {c.peopleLabel}
            </dt>
            <dd className="lp-ont-field-value lp-ont-people">
              {c.people.map((p, i) => (
                <span key={p.id} className="lp-ont-person lp-ont-fade" style={at(c.peopleAt + 150 + i * 180)}>
                  <PersonFace id={p.id} d={20} />
                  {p.airport}
                </span>
              ))}
              <span className="lp-ont-person-more lp-ont-fade" style={at(c.peopleAt + 700)}>
                {c.more}
              </span>
            </dd>
          </div>
        </dl>

        <p className="lp-ont-rule lp-ont-rise" style={at(c.templateAt)}>
          <span className="lp-ont-badge">{c.templateBadge}</span>
          {c.template}
        </p>
      </div>
    </div>
  );
}

// ── 2 · Channels ────────────────────────────────────────────────────────

export { CHANNEL_END_MS };

const CHANNEL_FACES = ["orchestrator", "scout", "liaison", "booker"] as const;

export function ChannelsWindow() {
  return (
    <div className="lp-ont-win lp-ont-win--chan" aria-hidden="true">
      <div className="lp-ont-feed">
      <div className="lp-ont-chan-head">
        <span className="lp-ont-chan-name">
          <Hash size={14} strokeWidth={2} />
          {CHANNEL.name}
        </span>
        <span className="lp-ont-faces">
          <PersonFace id="sam" d={22} />
          {CHANNEL_FACES.map((id) => (
            <AgentFace key={id} id={id} d={22} />
          ))}
        </span>
      </div>

      <div className="lp-ont-thread">
        {CHANNEL.lines.map((line, i) => {
          const slot = THREAD_SLOTS[i];
          if (line.kind === "event") {
            return (
              <div key={i} className="lp-ont-grow" style={at(slot.at)}>
                <div>
                  <p className="lp-ont-event">
                    <Plus size={11} strokeWidth={2.5} />
                    {line.text}
                  </p>
                </div>
              </div>
            );
          }
          const agent = actorAgent(line.from);
          return (
            <div key={i}>
              {"typing" in slot && slot.typing !== undefined && agent ? (
                <div className="lp-ont-typing" style={at(slot.typing, THREAD.typing)}>
                  <div>
                    <p className="lp-ont-typing-line">
                      {agent.name} is typing
                      <span className="lp-ont-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="lp-ont-grow" style={at(slot.at)}>
                <div>
                  <div
                    className={agent ? "lp-ont-post lp-ont-post--agent" : "lp-ont-post"}
                    style={agent ? accent(agent.color) : undefined}
                  >
                    <ActorFace actor={line.from} d={24} />
                    <span className="lp-ont-post-body">
                      <span className="lp-ont-post-name">
                        {actorName(line.from)}
                        {agent ? <span className="lp-ont-post-runtime">{agent.runtime.name}</span> : null}
                      </span>
                      <span className="lp-ont-post-text">
                        <WithMentions text={line.text} />
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>

      <AgentRail />
    </div>
  );
}

// ── 3 · Tasks ───────────────────────────────────────────────────────────

// PLANNED: task tracker not shipped yet (see ./ontology-content.ts › TASKS).

function StatusMark({ status }: { status: TaskStatus }) {
  if (status === "done")
    return (
      <span className="lp-ont-tick lp-ont-tick--done">
        <Check size={10} strokeWidth={3} />
      </span>
    );
  return <span className={status === "working" ? "lp-ont-tick lp-ont-tick--working" : "lp-ont-tick"} />;
}

/** Done-count over time, from the rows' own "done" steps. */
const DONE_TIMES = TASKS.rows
  .flatMap((row) => row.steps.filter(([s]) => s === "done").map(([, t]) => t))
  .sort((a, b) => a - b);
const COUNT_STEPS: [number, number][] = [
  [0, 0],
  ...DONE_TIMES.map((t, i): [number, number] => [i + 1, t]),
];

export function TasksWindow() {
  const total = TASKS.rows.length;
  return (
    <div className="lp-ont-win lp-ont-win--tasks" aria-hidden="true">
      <div className="lp-ont-tasks-head">
        <span>
          <p className="lp-ont-win-label">{TASKS.label}</p>
          <h3 className="lp-ont-win-title">{TASKS.title}</h3>
        </span>
        <span className="lp-ont-progress">
          <span className="lp-ont-progress-count">
            <Sequence steps={COUNT_STEPS} render={(n) => `${n} / ${total}`} />
          </span>
          <span className="lp-ont-segs">
            {TASKS.rows.map((_, i) => (
              <i key={i}>
                {i < DONE_TIMES.length ? <b className="lp-ont-fill" style={at(DONE_TIMES[i])} /> : null}
              </i>
            ))}
          </span>
        </span>
      </div>

      <ul className="lp-ont-tasks">
        {TASKS.rows.map((row) => (
          <li key={row.title} className="lp-ont-task">
            <Sequence steps={row.steps} render={(s) => <StatusMark status={s} />} />
            <span className="lp-ont-task-title">{row.title}</span>
            <span className="lp-ont-task-owner">
              <ActorFace actor={row.owner} d={20} />
              {actorName(row.owner)}
            </span>
            <Sequence
              className="lp-ont-stack lp-ont-stack--end"
              steps={row.steps}
              render={(s) => <span className={`lp-ont-status lp-ont-status--${s}`}>{TASK_STATUS_LABEL[s]}</span>}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
