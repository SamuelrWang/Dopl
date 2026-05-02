"use client";

import { useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Mic,
  Paperclip,
} from "lucide-react";

export function ChatThread() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-8">
        <UserMessage>
          Build me a bot that buys &ldquo;No&rdquo; on every standalone
          non-sports yes/no market and holds to resolution. Use what&rsquo;s
          already in my workspace.
        </UserMessage>

        <div className="space-y-4">
          <Lead>
            I&rsquo;ll wire this up using your Polymarket skill and the
            entries already in your trading-bot knowledge base. Here&rsquo;s
            what I pulled and the plan.
          </Lead>

          <DoplAgentGroup>
            <AgentRow
              kind="Searched knowledge base"
              target="polymarket clob auth"
              meta="4 results · Polymarket Trading Bots"
              expanded
            >
              <KbResults
                base="Polymarket Trading Bots"
                items={[
                  {
                    title: "CLOB Authentication",
                    snippet:
                      "L2 API key derived from L1 EOA signature; cache per-EOA on disk.",
                  },
                  {
                    title: "Order placement & nonce handling",
                    snippet:
                      "Nonce + timestamp included in every signed order to prevent replay.",
                  },
                  {
                    title: "Async polling strategy",
                    snippet:
                      "Single asyncio.Queue feeding a worker pool; 250ms market scan loop.",
                  },
                  {
                    title: "Standalone-market filter",
                    snippet:
                      "Heuristic for excluding sports / multi-leg / event-bundled markets.",
                  },
                ]}
              />
            </AgentRow>

            <AgentRow
              kind="Read entry"
              target="CLOB Authentication"
              meta="2 min read"
            />
            <AgentRow
              kind="Read entry"
              target="Order placement & nonce handling"
              meta="3 min read"
            />
            <AgentRow
              kind="Loaded skill"
              target="dopl-polymarket-trading-bots"
              meta="installed · v0.4.1"
            />
            <AgentRow
              kind="Created canvas panel"
              target="Implementation Plan"
              meta="cluster: Polymarket Trading Bots"
            />
          </DoplAgentGroup>

          <Body>
            <H2>Implementation plan</H2>
            <p>
              Four pieces. Each maps to one file in the skill scaffold —
              the canvas panel I created mirrors the same structure so you
              can tick them off as you go.
            </p>

            <H3>Auth bootstrapping</H3>
            <p>
              Re-use the L1/L2 derivation from{" "}
              <EntryLink>CLOB Authentication</EntryLink>
              <Cite n={1} />. Keep the L1 key in an env var, cache the L2
              creds at <Mono>~/.dopl/polymarket/{`{eoa}`}.json</Mono> with{" "}
              <Mono>0600</Mono> perms, re-derive every 30 days.
            </p>

            <H3>Market filter</H3>
            <p>
              The standalone-market heuristic is the trickiest part —
              your{" "}
              <EntryLink>Standalone-market filter</EntryLink>
              <Cite n={2} /> entry has a working version. I&rsquo;d gate
              on three signals: <Mono>category != &quot;sports&quot;</Mono>,
              single condition, no event bundle.
            </p>

            <H3>Order placement</H3>
            <p>
              Async worker pool, one task per market scan. Nonce handling
              comes from{" "}
              <EntryLink>Order placement &amp; nonce handling</EntryLink>
              <Cite n={3} />. Place at <Mono>best_bid - 1¢</Mono> so
              you&rsquo;re always passive, never crossing the spread.
            </p>
          </Body>
        </div>

        <UserMessage>
          Looks good. Add a <Mono>check_resolution</Mono> skill that
          reconciles fills against on-chain settlement, and queue it on
          the canvas.
        </UserMessage>

        <div className="space-y-4">
          <ThinkingDropdown duration="2s">
            New skill, not an entry — write it as a TypeScript skill and
            sync to /skills. Reconciliation reads settlement events from
            the resolver contract; expose as a daily cron.
          </ThinkingDropdown>

          <DoplAgentGroup>
            <AgentRow
              kind="Created skill"
              target="check_resolution"
              meta="typescript · cron daily"
            />
            <AgentRow
              kind="Synced to /skills"
              target="dopl skill push check_resolution"
              meta="published"
            />
            <AgentRow
              kind="Updated canvas panel"
              target="Implementation Plan"
              meta="added reconciliation step"
            />
          </DoplAgentGroup>

          <Streaming label="Generating check_resolution.ts" />
        </div>
      </div>

      <Composer />
    </div>
  );
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl px-4 py-2.5 bg-white/[0.06] border border-white/[0.08] text-[13.5px] leading-relaxed text-text-primary whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-relaxed text-text-primary">{children}</p>
  );
}

function DoplAgentGroup({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full bg-gradient-to-br from-violet-300 to-cyan-300" />
        <span className="text-[12px] font-medium text-text-primary">
          Dopl agent
        </span>
      </div>
      <div className="border-l border-white/[0.08] pl-3 ml-[3px] flex flex-col">
        {children}
      </div>
    </div>
  );
}

interface AgentRowProps {
  kind: string;
  target: string;
  meta?: string;
  expanded?: boolean;
  children?: React.ReactNode;
}

function AgentRow({ kind, target, meta, expanded, children }: AgentRowProps) {
  const [open, setOpen] = useState(Boolean(expanded));
  const hasContent = Boolean(children);
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        className={
          "w-full flex items-center gap-2 text-left " +
          (hasContent ? "cursor-pointer" : "cursor-default")
        }
      >
        <span className="text-[12.5px] text-text-secondary/55 shrink-0">
          {kind}
        </span>
        <span className="text-[12.5px] text-text-secondary/85 font-medium truncate">
          {target}
        </span>
        {meta && (
          <span className="text-[11px] text-text-secondary/40 truncate">
            · {meta}
          </span>
        )}
        {hasContent && (
          <span className="ml-auto shrink-0 text-text-secondary/50">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>
      {open && hasContent && (
        <div className="mt-2 mb-1 ml-0">{children}</div>
      )}
    </div>
  );
}

interface KbItem {
  title: string;
  snippet: string;
}

function KbResults({ base, items }: { base: string; items: KbItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-text-secondary/40 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-text-primary truncate">
              {it.title}
            </p>
            <p className="text-[11.5px] text-text-secondary/70 leading-relaxed">
              {it.snippet}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-text-secondary/40 font-mono">
            {base}
          </span>
        </div>
      ))}
    </div>
  );
}

function ThinkingDropdown({
  duration,
  children,
}: {
  duration: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-text-secondary/70 hover:text-text-primary transition-colors cursor-pointer"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Thought for {duration}</span>
      </button>
      {open && (
        <div className="mt-2 ml-4 text-[12.5px] leading-relaxed text-text-secondary/75 italic">
          {children}
        </div>
      )}
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13.5px] leading-relaxed text-text-primary/90 space-y-3 [&>p]:my-0">
      {children}
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[15px] font-semibold text-text-primary mt-4 mb-1">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-semibold text-text-primary mt-3 mb-0.5">
      {children}
    </h3>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-white/[0.05] text-text-primary/90">
      {children}
    </code>
  );
}

function EntryLink({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-text-primary underline decoration-white/20 underline-offset-2">
      {children}
    </span>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 text-[10px] text-text-secondary/60">[{n}]</sup>
  );
}

function Streaming({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
      <span className="flex items-end gap-0.5">
        <span className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse" />
        <span
          className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-violet-300/80 animate-pulse"
          style={{ animationDelay: "300ms" }}
        />
      </span>
      <span>{label}</span>
    </div>
  );
}

function Composer() {
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2">
        <button
          type="button"
          aria-label="Attach file"
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-secondary/70 hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
        >
          <Paperclip size={14} />
        </button>
        <textarea
          rows={1}
          placeholder="Send a message…"
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 outline-none py-1 max-h-40"
        />
        <button
          type="button"
          aria-label="Voice input"
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-secondary/70 hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
        >
          <Mic size={14} />
        </button>
        <button
          type="button"
          aria-label="Send message"
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-white text-black hover:bg-white/90 transition-colors cursor-pointer"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}
