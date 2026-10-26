/**
 * STAGING STAND-IN for `apps/desktop-ui/src/pages/home/use-home-channels.ts`:
 * the operator's home channels, from the fake data file instead of
 * `GET /api/channels?scope=account`. Only `id` and `name` are read by the share
 * popup and the delete confirm. ⚠ PORTING: do not port.
 */
import { DEMO_HOME_CHANNELS } from "../data/demo-ontology-data";

export interface StagingHomeChannel {
  id: string;
  name: string;
}

export function useHomeChannels(): readonly StagingHomeChannel[] {
  return DEMO_HOME_CHANNELS;
}
