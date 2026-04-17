import { redirect } from "next/navigation";

/**
 * `/browse` has no content of its own — the real pages are at
 * /browse/entries and /browse/clusters. Default to entries.
 */
export default function BrowseRoot() {
  redirect("/browse/entries");
}
