"use client";

import { MarkdownMessage } from "@/shared/design";
import type { ChatMessage } from "@/features/ingestion/components/chat-message";
import { SentAttachmentPreview } from "./chat-attachments";
import { DoplAgentGroup } from "./dopl-agent-group";
import { AgentRow } from "./agent-row";
import { KbResults } from "./kb-results";
import { Lead } from "./lead";
import { StreamingIndicator } from "./streaming-indicator";
import { AgentPromptCard } from "./agent-prompt-card";
import { ContextFileCard } from "./context-file-card";

type EntryRef = {
  entry_id: string;
  title?: string;
  summary?: string;
  source_url?: string;
};

interface AgentStep {
  toolName: string;
  status: "calling" | "done";
  summary?: string;
  /** Entry references that arrived between the calling and done events. */
  entries: EntryRef[];
}

type Block =
  | { kind: "user-text"; message: Extract<ChatMessage, { role: "user"; type: "text" }> }
  | { kind: "ai-text"; content: string }
  | { kind: "ai-streaming"; content: string }
  | { kind: "agent-group"; steps: AgentStep[] }
  | { kind: "agent-prompt"; message: Extract<ChatMessage, { type: "agent_prompt_artifact" }> }
  | { kind: "context-file"; message: Extract<ChatMessage, { type: "context_file_artifact" }> }
  | { kind: "trial-expired"; text: string };

/**
 * Convert the raw `ChatMessage[]` log into a sequence of visual blocks.
 *
 * The most interesting transform: consecutive `tool_activity` and
 * `entry_cards` messages collapse into a single agent-group block,
 * with calling/done events merged per tool occurrence. Anything else
 * closes the open group.
 */
function blockify(messages: ChatMessage[]): Block[] {
  const blocks: Block[] = [];
  let openSteps: AgentStep[] | null = null;

  function closeGroup() {
    if (openSteps && openSteps.length > 0) {
      blocks.push({ kind: "agent-group", steps: openSteps });
    }
    openSteps = null;
  }

  for (const m of messages) {
    if (m.role === "ai" && m.type === "tool_activity") {
      if (!openSteps) openSteps = [];
      if (m.status === "calling") {
        openSteps.push({
          toolName: m.toolName,
          status: "calling",
          entries: [],
        });
      } else {
        // status === "done" — close the most recent matching pending step.
        for (let i = openSteps.length - 1; i >= 0; i--) {
          if (
            openSteps[i].toolName === m.toolName &&
            openSteps[i].status === "calling"
          ) {
            openSteps[i] = {
              ...openSteps[i],
              status: "done",
              summary: m.summary,
            };
            break;
          }
        }
      }
      continue;
    }

    if (m.role === "ai" && m.type === "entry_cards") {
      if (!openSteps || openSteps.length === 0) {
        // Defensive: entry_cards arrived without an open tool — treat
        // as its own group with a virtual "found" row.
        openSteps = [
          { toolName: "search", status: "done", entries: m.entries },
        ];
      } else {
        const last = openSteps[openSteps.length - 1];
        last.entries = [...last.entries, ...m.entries];
      }
      continue;
    }

    closeGroup();

    if (m.role === "user" && m.type === "text") {
      blocks.push({ kind: "user-text", message: m });
    } else if (m.role === "ai" && m.type === "text") {
      blocks.push({ kind: "ai-text", content: m.content });
    } else if (m.role === "ai" && m.type === "streaming") {
      blocks.push({ kind: "ai-streaming", content: m.content });
    } else if (m.role === "ai" && m.type === "agent_prompt_artifact") {
      blocks.push({ kind: "agent-prompt", message: m });
    } else if (m.role === "ai" && m.type === "context_file_artifact") {
      blocks.push({ kind: "context-file", message: m });
    } else if (m.role === "ai" && m.type === "trial_expired") {
      blocks.push({ kind: "trial-expired", text: m.message });
    }
    // Other variants (progress, artifacts, onboarding_card) are
    // canvas-chat specific and shouldn't appear here. Silently skip.
  }

  closeGroup();
  return blocks;
}

const TOOL_KIND_LABEL: Record<string, string> = {
  search_knowledge_base: "Searched Dopl catalog",
  get_entry_details: "Read catalog entry",
  list_workspace_clusters: "Listed clusters",
  list_cluster_brain_memories: "Read cluster brain",
  list_workspace_knowledge_bases: "Listed knowledge bases",
  search_workspace_knowledge: "Searched workspace knowledge",
  read_knowledge_entry: "Read knowledge entry",
  list_workspace_skills: "Listed skills",
  read_skill_file: "Read skill file",
  emit_agent_prompt: "Drafted agent prompt",
  emit_context_file: "Synthesized context file",
};

interface PrivateMessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onPromoteArtifact?: (input: {
    artifactId: string;
    title: string;
    markdown: string;
  }) => Promise<string | void>;
}

/**
 * Top-level list renderer for the private chat thread. Drives the
 * UserMessage / Lead / DoplAgentGroup / artifact-card layout from the
 * original demo, only now powered by real `ChatMessage[]` data.
 */
export function PrivateMessageList({
  messages,
  isStreaming,
  onPromoteArtifact,
}: PrivateMessageListProps) {
  const blocks = blockify(messages);

  return (
    <div className="space-y-6">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "user-text":
            return (
              <UserBubble key={i}>
                <p className="whitespace-pre-wrap break-words">
                  {block.message.content}
                </p>
                {block.message.attachments &&
                  block.message.attachments.length > 0 && (
                    <SentAttachmentPreview attachments={block.message.attachments} />
                  )}
              </UserBubble>
            );
          case "ai-text":
            return (
              <div key={i} className="space-y-3">
                {/* First short paragraph reads as a Lead; markdown handles the rest. */}
                <div className="text-[13.5px] leading-relaxed text-text-primary/90">
                  <MarkdownMessage content={block.content} />
                </div>
              </div>
            );
          case "ai-streaming":
            return (
              <div key={i} className="space-y-2">
                {block.content.length > 0 ? (
                  <div className="text-[13.5px] leading-relaxed text-text-primary/90">
                    <MarkdownMessage content={block.content + " ▍"} />
                  </div>
                ) : (
                  <Lead>
                    <span className="italic text-text-secondary/70">
                      Thinking…
                    </span>
                  </Lead>
                )}
              </div>
            );
          case "agent-group": {
            const lastStillCalling = block.steps.some(
              (s) => s.status === "calling"
            );
            return (
              <DoplAgentGroup key={i} streaming={lastStillCalling && isStreaming}>
                {block.steps.map((step, j) => {
                  const kind =
                    TOOL_KIND_LABEL[step.toolName] ?? step.toolName;
                  const target = step.summary ?? "…";
                  const meta =
                    step.status === "calling" ? "running" : undefined;
                  const items = step.entries.map((e) => ({
                    title: e.title || "Untitled",
                    snippet: e.summary || "",
                    href: e.entry_id
                      ? `/entries/${e.entry_id}`
                      : undefined,
                  }));
                  return (
                    <AgentRow
                      key={j}
                      kind={kind}
                      target={target}
                      meta={meta}
                      pending={step.status === "calling"}
                      expanded={items.length > 0}
                    >
                      {items.length > 0 ? <KbResults items={items} /> : null}
                    </AgentRow>
                  );
                })}
              </DoplAgentGroup>
            );
          }
          case "agent-prompt":
            return (
              <div key={i} className="max-w-[95%] mr-auto">
                <AgentPromptCard
                  title={block.message.title}
                  prompt={block.message.prompt}
                  promotedPanelId={block.message.promotedPanelId}
                  onPromote={
                    onPromoteArtifact
                      ? ({ title, markdown }) =>
                          onPromoteArtifact({
                            artifactId: block.message.artifactId,
                            title,
                            markdown,
                          })
                      : undefined
                  }
                />
              </div>
            );
          case "context-file":
            return (
              <div key={i} className="max-w-[95%] mr-auto">
                <ContextFileCard
                  title={block.message.title}
                  markdown={block.message.markdown}
                  promotedPanelId={block.message.promotedPanelId}
                  onPromote={
                    onPromoteArtifact
                      ? ({ title, markdown }) =>
                          onPromoteArtifact({
                            artifactId: block.message.artifactId,
                            title,
                            markdown,
                          })
                      : undefined
                  }
                />
              </div>
            );
          case "trial-expired":
            return (
              <div
                key={i}
                className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 max-w-[95%] mr-auto"
              >
                {block.text}
              </div>
            );
          default:
            return null;
        }
      })}
      {isStreaming &&
        blocks[blocks.length - 1]?.kind !== "ai-streaming" && (
          <StreamingIndicator label="Thinking" />
        )}
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl px-4 py-2.5 bg-white/[0.06] border border-white/[0.08] text-[13.5px] leading-relaxed text-text-primary">
        {children}
      </div>
    </div>
  );
}
