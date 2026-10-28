/** UI-STAGING FAKE DATA: the channels the Tasks page scopes by. `tech-debt` is the staged one. */

export interface StagingTaskChannel {
  id: string;
  name: string;
}

export const STAGING_TASK_CHANNELS: StagingTaskChannel[] = [
  { id: "ch-tech-debt", name: "tech-debt" },
  { id: "ch-releases", name: "releases" },
  { id: "ch-research", name: "research" },
];

export function channelName(id: string): string {
  return STAGING_TASK_CHANNELS.find((c) => c.id === id)?.name ?? "a channel";
}
