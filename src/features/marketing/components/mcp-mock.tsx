"use client";

import { Check, Copy } from "lucide-react";

import {
  MCP_CLIENT_CYCLES,
  MCP_CYCLE_LENGTH,
  MCP_CYCLE_START_TICK,
  MCP_FLY_IN_TICK,
  MCP_TYPE_CHARS_PER_TICK,
} from "../constants";
import { PageTopBar } from "./page-top-bar";
import { RevealOnMount } from "./reveal";

export function McpMock({ mcpTick }: { mcpTick: number }) {
  // Phases: hidden (0..3) → fly-in (4..7) → cycles (8+).
  const showTerminal = mcpTick >= MCP_FLY_IN_TICK;
  const inCycles = mcpTick >= MCP_CYCLE_START_TICK;
  const elapsedInCycles = inCycles ? mcpTick - MCP_CYCLE_START_TICK : 0;
  const cycleIdx = inCycles
    ? Math.floor(elapsedInCycles / MCP_CYCLE_LENGTH) %
      MCP_CLIENT_CYCLES.length
    : 0;
  const inCycleTick = inCycles ? elapsedInCycles % MCP_CYCLE_LENGTH : 0;
  const activeClient = MCP_CLIENT_CYCLES[cycleIdx];
  // Within each 14-tick cycle: ticks 0..9 = typing, 10..13 = response shown.
  const typeWindow = MCP_CYCLE_LENGTH - 4;
  const charsTyped = inCycles
    ? Math.min(activeClient.cmd.length, inCycleTick * MCP_TYPE_CHARS_PER_TICK)
    : 0;
  const isTyping =
    inCycles && inCycleTick < typeWindow && charsTyped < activeClient.cmd.length;
  const showResponse =
    inCycles && (inCycleTick >= typeWindow || charsTyped >= activeClient.cmd.length);

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="MCP Server"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white border border-white/[0.08] px-2.5 py-1 rounded-md"
          >
            <Copy size={12} /> Copy URL
          </button>
        }
      />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto px-8 py-6 min-w-0">
          <div className="space-y-5 max-w-xl">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">
                Server endpoint
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-[13px] text-white/90 px-3 py-2 rounded-md bg-black/40 border border-white/[0.06] truncate">
                  mcp.dopl.ai/u/sam-wang
                </div>
                <button
                  type="button"
                  className="p-2 rounded-md border border-white/[0.08] text-white/60 hover:text-white shrink-0"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <div className="text-[13px] font-medium text-white">
                  Connected clients
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  Detected agents on this device
                </div>
              </div>
              <div className="divide-y divide-white/[0.04]">
                <ClientRow
                  name="Claude Code"
                  path="~/.claude.json"
                  status="connected"
                />
                <ClientRow
                  name="Claude Desktop"
                  path="~/Library/.../claude_desktop_config.json"
                  status="connected"
                />
                <ClientRow
                  name="Cursor"
                  path="not detected"
                  status="disconnected"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Floating terminal — flies in once at MCP_FLY_IN_TICK, then its
            inner content swaps per cycle (re-keyed on cycleIdx so each new
            client starts typing fresh). */}
        <div className="w-[440px] shrink-0 px-6 py-6 flex items-start">
          {showTerminal && (
            <RevealOnMount from="right">
              <div className="w-full rounded-xl overflow-hidden border border-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.6)] bg-black/80 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.08] bg-black/60">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                  <div
                    key={`title-${cycleIdx}`}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-white/60 font-mono"
                    style={{ animation: "fadeIn 220ms ease-out" }}
                  >
                    <span className="w-4 h-4 rounded bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-[8px] font-semibold text-white/80">
                      {activeClient.badge}
                    </span>
                    {activeClient.name}
                  </div>
                </div>
                <div
                  key={`body-${cycleIdx}`}
                  className="px-4 py-3 font-mono text-[12px] min-h-[180px] flex flex-col gap-2"
                  style={{ animation: "fadeIn 220ms ease-out" }}
                >
                  <div className="text-white/30 text-[10px] uppercase tracking-wider">
                    Connecting to MCP server
                  </div>
                  <div className="text-white/90 break-all leading-relaxed">
                    <span className="text-white/40">$ </span>
                    {charsTyped > 0 ? (
                      <ColorizedCmd cmd={activeClient.cmd.slice(0, charsTyped)} />
                    ) : null}
                    {isTyping && (
                      <span className="inline-block w-[6px] h-[12px] bg-white/70 align-middle ml-0.5 animate-pulse" />
                    )}
                  </div>
                  {showResponse && (
                    <div
                      className="text-emerald-400 flex items-center gap-1.5"
                      style={{ animation: "fadeIn 280ms ease-out" }}
                    >
                      <Check size={11} className="shrink-0" />
                      <span>{activeClient.response}</span>
                    </div>
                  )}
                </div>
              </div>
            </RevealOnMount>
          )}
        </div>
      </div>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

function ColorizedCmd({ cmd }: { cmd: string }) {
  const urlIdx = cmd.indexOf("https://");
  if (urlIdx === -1) {
    const spaceIdx = cmd.indexOf(" ");
    if (spaceIdx === -1) {
      return <span className="text-emerald-400">{cmd}</span>;
    }
    return (
      <>
        <span className="text-emerald-400">{cmd.slice(0, spaceIdx)}</span>
        <span className="text-white/85">{cmd.slice(spaceIdx)}</span>
      </>
    );
  }
  const before = cmd.slice(0, urlIdx);
  const url = cmd.slice(urlIdx);
  const spaceIdx = before.indexOf(" ");
  return (
    <>
      <span className="text-emerald-400">
        {spaceIdx === -1 ? before : before.slice(0, spaceIdx)}
      </span>
      <span className="text-white/85">
        {spaceIdx === -1 ? "" : before.slice(spaceIdx)}
      </span>
      <span className="text-cyan-300 break-all">{url}</span>
    </>
  );
}

function ClientRow({
  name,
  path,
  status,
}: {
  name: string;
  path: string;
  status: "connected" | "disconnected";
}) {
  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <div className="w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[10px] font-mono text-white/60 shrink-0">
        {name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-white">{name}</div>
        <div className="text-[11px] text-white/40 font-mono truncate">
          {path}
        </div>
      </div>
      {status === "connected" ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{" "}
            Connected
          </span>
          <button
            type="button"
            className="text-[11px] text-white/60 hover:text-white px-2 py-1"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-white/40 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-white/30" /> Not
            connected
          </span>
          <button
            type="button"
            className="text-[11px] text-black bg-white px-3 py-1 rounded-md font-medium"
          >
            Connect
          </button>
        </>
      )}
    </div>
  );
}
