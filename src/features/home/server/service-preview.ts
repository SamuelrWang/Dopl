import "server-only";
import { IdentitiesPreviewSchema, OverviewPreviewSchema, type HomePreview } from "../preview-types";
import { listOwnPreviewRows } from "./repository-preview";

/** The reader's preview payloads, each parsed leniently; a surface with no row is `null`. */
export async function getHomePreview(userId: string): Promise<HomePreview> {
  const rows = await listOwnPreviewRows(userId);
  const payloadOf = (surface: string) => rows.find((row) => row.surface === surface)?.payload;
  const overview = payloadOf("overview");
  const identities = payloadOf("identities");
  return {
    overview: overview === undefined ? null : OverviewPreviewSchema.parse(overview),
    identities: identities === undefined ? null : IdentitiesPreviewSchema.parse(identities),
  };
}
