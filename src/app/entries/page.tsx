import { redirect } from "next/navigation";

/**
 * Legacy route. The browse UI moved to /browse/entries so entries +
 * clusters can share a layout with the smart chat rail. Old bookmarks
 * and outbound links still land here → we 307 to the new path.
 *
 * `/entries/[id]` (individual entry detail) is unaffected — that
 * dynamic route still lives in this folder.
 */
export default function EntriesLegacyRedirect() {
  redirect("/browse/entries");
}
