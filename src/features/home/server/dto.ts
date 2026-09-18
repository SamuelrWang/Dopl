import "server-only";

/**
 * `snake_case` → `camelCase` for the home surface. No row shape leaves here.
 *
 * ⚠ **THE LINK HALF MOVED TO `shared/links/dto.ts` IN WAVE 3 (R-26)** — an open
 * bound link is a field of `Channel` now, and §1 forbids `channels → home`. It is
 * RE-EXPORTED here verbatim, so `import { … } from "./dto"` is unchanged for every
 * home caller and there is still one definition.
 */

export type { ChannelLinkRow } from "@/shared/links/dto";
export {
  CHANNEL_LINK_COLS,
  claimUrl,
  isClaimable,
  linkState,
  mapLinkRow,
} from "@/shared/links/dto";

/** The container workspace, and only the columns the payload addresses it by. */
export const LINK_CONTAINER_COLS = "id, slug, public_id, created_at";

export interface LinkContainerRow {
  id: string;
  slug: string;
  public_id: string;
  created_at: string;
}
