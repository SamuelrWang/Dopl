"use client";

import { ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import {
  AgentFace,
  PersonFace,
  Sequence,
  Typed,
  accent,
  at,
} from "./ontology-bits";
import { AGENTS, COMMAND, DOPL_MARK, type AgentId } from "./ontology-content";

/**
 * 4 · Command — the default tab. Two things happening at once: on the LEFT,
 * Dopl's notification stream (agents launching agents, one asking for a
 * decision, one finishing); on the RIGHT, the user drilling down the agent
 * tree (Orchestrator › Booker) and messaging that sub-agent directly,
 * with its context, permission level, runtime and parent in view.
 *
 * Same play contract as ./ontology-windows.tsx (helpers: ./ontology-bits.tsx);
 * words and beats: ./ontology-content.ts › COMMAND.
 */

/** Newest on top: DOM order is reversed, so each arrival grows in above the
 *  others and pushes them down. */
const NOTIFS_NEWEST_FIRST = [...COMMAND.notifications].reverse();

/** The agent in view as the user drills down — one crumb at a time. */
const HEAD_STEPS = COMMAND.crumbs.map((c): [AgentId, number] => [
  c.agent,
  c.at,
]);

export function CommandWindow() {
  const c = COMMAND;
  const focus = AGENTS[c.focus];
  const parent = AGENTS[c.parent];
  return (
    <div className="lp-ont-win" aria-hidden="true">
      <div className="lp-ont-notifs">
        <p className="lp-ont-win-label">{c.notificationsLabel}</p>
        <div className="lp-ont-notif-list">
          {NOTIFS_NEWEST_FIRST.map((n) => (
            <div key={n.title} className="lp-ont-grow" style={at(n.at)}>
              <div>
                <div className="lp-ont-notif">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local asset */}
                  <img
                    src={DOPL_MARK}
                    alt=""
                    className="lp-ont-notif-mark"
                    draggable={false}
                  />
                  <span className="lp-ont-notif-text">
                    <span className="lp-ont-notif-title">{n.title}</span>
                    <span className="lp-ont-notif-body">{n.body}</span>
                    {"decision" in n && n.decision ? (
                      <span className="lp-ont-notif-actions">
                        <span className="lp-ont-btn lp-ont-btn--ink">
                          {c.approve}
                        </span>
                        <span className="lp-ont-btn">{c.deny}</span>
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lp-ont-agent-col" style={accent(focus.color)}>
        <div className="lp-ont-crumbs">
          {c.crumbs.map((crumb, i) => (
            <span
              key={crumb.agent}
              className={
                i === c.crumbs.length - 1
                  ? "lp-ont-crumb lp-ont-crumb--here lp-ont-fade"
                  : "lp-ont-crumb lp-ont-fade"
              }
              style={at(crumb.at)}
            >
              {i > 0 ? (
                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  className="lp-ont-crumb-sep"
                />
              ) : null}
              <span className="lp-ont-crumb-face">
                <AgentFace id={crumb.agent} d={16} />
              </span>
              {AGENTS[crumb.agent].name}
            </span>
          ))}
        </div>

        <div className="lp-ont-agent">
          <div className="lp-ont-agent-head">
            <Sequence
              className="lp-ont-stack"
              steps={HEAD_STEPS}
              render={(id) => (
                <span className="lp-ont-agent-id">
                  <AgentFace id={id} d={28} />
                  <span className="lp-ont-agent-name">{AGENTS[id].name}</span>
                </span>
              )}
            />
            <span className="lp-ont-live lp-ont-fade" style={at(c.infoAt)}>
              <i />
              {c.liveness}
            </span>
          </div>

          <dl className="lp-ont-info lp-ont-rise" style={at(c.infoAt)}>
            <div>
              <dt>{c.info.context}</dt>
              <dd>
                {c.info.contextValue}
                <span className="lp-ont-meter">
                  <b
                    className="lp-ont-fill"
                    style={{
                      ...at(c.infoAt + 200),
                      width: `${c.info.contextFill * 100}%`,
                    }}
                  />
                </span>
              </dd>
            </div>
            <div>
              <dt>{c.info.permission}</dt>
              <dd>
                {/* A dropdown face: the current level and a caret (the real control is a menu). */}
                <span className="lp-ont-select">
                  {c.info.level}
                  <ChevronDown size={11} strokeWidth={2.2} />
                </span>
              </dd>
            </div>
            <div>
              <dt>{c.info.runtime}</dt>
              <dd>
                {/* eslint-disable-next-line @next/next/no-img-element -- local asset */}
                <img
                  src={focus.runtime.logo}
                  alt=""
                  className="lp-ont-info-logo"
                  draggable={false}
                />
                {focus.runtime.name}
              </dd>
            </div>
            <div>
              <dt>{c.info.parent}</dt>
              <dd>
                <AgentFace id={c.parent} d={16} />
                {parent.name}
              </dd>
            </div>
          </dl>

          <div className="lp-ont-lane">
            <div className="lp-ont-grow" style={at(c.stream.at)}>
              <div>
                <p className="lp-ont-stream">{c.stream.text}</p>
              </div>
            </div>
            <div className="lp-ont-grow" style={at(c.sentAt)}>
              <div>
                <div className="lp-ont-msg lp-ont-msg--me">
                  <p className="lp-ont-bubble lp-ont-bubble--me">{c.mine}</p>
                  <PersonFace id="sam" d={20} />
                </div>
              </div>
            </div>
            <div
              className="lp-ont-typing"
              style={at(c.replyTypingAt, c.reply.at - c.replyTypingAt)}
            >
              <div>
                <p className="lp-ont-typing-line">
                  {focus.name} is typing
                  <span className="lp-ont-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </p>
              </div>
            </div>
            <div className="lp-ont-grow" style={at(c.reply.at)}>
              <div>
                <div className="lp-ont-msg">
                  <AgentFace id={c.focus} d={20} />
                  <p className="lp-ont-bubble">{c.reply.text}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lp-ont-composer">
            <span className="lp-ont-stack lp-ont-composer-text">
              <span
                className="lp-ont-off lp-ont-composer-hint"
                style={at(c.typeAt, c.sentAt - c.typeAt)}
              >
                {c.composerPlaceholder}
              </span>
              <span
                className="lp-ont-on"
                style={at(c.typeAt, c.sentAt - c.typeAt)}
              >
                <Typed text={c.mine} start={c.typeAt} step={c.typeStep} />
                <span className="lp-ont-caret" />
              </span>
            </span>
            <span className="lp-ont-send">
              <ArrowUp size={12} strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
