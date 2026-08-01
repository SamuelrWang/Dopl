export { ChannelsView } from "./components/channels-view";
export { AgentChipsBar, AgentStatusDot } from "./components/agent-chips-bar";
export { MentionPopup, SlashCommandHint } from "./components/mention-popup";
export { RoomsSidebar } from "./components/rooms-sidebar";
export { useChannelAgents } from "./hooks/use-channel-agents";
export type { ChannelAgentsState } from "./hooks/use-channel-agents";
export type {
  AgentStatus,
  AgentToolProfile,
  AgentTrustRule,
  Channel,
  ChannelAgent,
  ChannelConsentRequest,
  ChannelDetail,
  ChannelMember,
  ChannelMessage,
  ChannelMessageKind,
  ChannelRole,
  ChannelVisibility,
  ConsentKind,
  ConsentStatus,
  MessageAuthorKind,
  NotifyScope,
  ParticipantKind,
  ThreadParticipant,
} from "./types";
