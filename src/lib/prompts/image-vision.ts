/**
 * Image-analysis prompt shared between the server-side vision step
 * (src/features/ingestion/server/extractors/image.ts) and the
 * agent-driven ingest flow (src/features/ingestion/server/agent-bundle.ts).
 * Keeping one copy means the two paths produce identical "extractedContent"
 * text for downstream persistence.
 */
export const IMAGE_ANALYSIS_PROMPT = `Analyze this image from a post about an AI/automation setup.
Determine what type of image this is:
- Code screenshot: Extract ALL code exactly as written
- Architecture diagram: Describe the full architecture, components, and data flow
- Terminal/CLI output: Extract all commands and their output
- UI screenshot: Describe the interface and its purpose
- Configuration file: Extract the full configuration
- Other: Describe what is shown

Provide your analysis with the type classification and full extracted content.`;
