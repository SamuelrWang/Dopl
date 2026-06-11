import { slugify } from "@/shared/lib/slug/slugify";

/**
 * Slugify a workflow name for use in URLs and MCP prompt names.
 * Output matches ^[a-z0-9-]+$ (MCP prompt name constraint).
 */
export function slugifyWorkflowName(
  name: string,
  existingSlugs: string[]
): string {
  return slugify(name, "workflow", existingSlugs);
}
