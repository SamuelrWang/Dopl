import { callClaude, ModelTier } from "@/lib/ai";
import { buildTagsPrompt } from "@/lib/prompts/tags";

interface GeneratedTag {
  tag_type: string;
  tag_value: string;
}

/**
 * Extract tags from the manifest without a Claude call. Falls back to
 * Claude only if the manifest yields very few tags (< 3).
 */
export async function generateTags(
  manifest: Record<string, unknown>,
  model?: ModelTier
): Promise<GeneratedTag[]> {
  const tags = extractTagsFromManifest(manifest);

  // If we got a reasonable number of tags, skip the AI call
  if (tags.length >= 3) return tags;

  // Fallback: use Claude for sparse manifests (knowledge/article content)
  return generateTagsWithClaude(manifest, model);
}

function extractTagsFromManifest(manifest: Record<string, unknown>): GeneratedTag[] {
  const tags: GeneratedTag[] = [];
  const seen = new Set<string>();

  function add(type: string, value: unknown) {
    if (typeof value !== "string" || !value.trim()) return;
    const normalized = value.trim().toLowerCase();
    const key = `${type}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    tags.push({ tag_type: type, tag_value: normalized });
  }

  function addArray(type: string, arr: unknown) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === "string") {
        add(type, item);
      } else if (item && typeof item === "object" && "name" in item) {
        add(type, (item as { name: string }).name);
      }
    }
  }

  // Tools
  addArray("tool", manifest.tools);

  // Integrations
  addArray("integration", manifest.integrations);

  // Languages
  addArray("language", manifest.languages);

  // Frameworks
  addArray("framework", manifest.frameworks);

  // Patterns
  addArray("pattern", manifest.patterns);

  // Use case
  const useCase = manifest.use_case;
  if (useCase && typeof useCase === "object") {
    const uc = useCase as Record<string, unknown>;
    add("use_case", uc.primary);
    addArray("use_case", uc.secondary);
  } else if (typeof useCase === "string") {
    add("use_case", useCase);
  }

  // Platform from source
  add("platform", manifest.platform);

  return tags;
}

async function generateTagsWithClaude(
  manifest: Record<string, unknown>,
  model?: ModelTier
): Promise<GeneratedTag[]> {
  const prompt = buildTagsPrompt(JSON.stringify(manifest, null, 2));
  const response = await callClaude("", prompt, { maxTokens: 2048, model });

  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const tags = JSON.parse(jsonStr) as GeneratedTag[];
    const validTypes = [
      "tool", "platform", "language", "framework",
      "use_case", "pattern", "integration", "custom",
    ];
    return tags.filter(
      (t) =>
        validTypes.includes(t.tag_type) &&
        typeof t.tag_value === "string" &&
        t.tag_value.length > 0
    );
  } catch (error) {
    console.error("Failed to parse tags JSON:", error);
    return [];
  }
}
