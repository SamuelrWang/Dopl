/**
 * Skill-authoring framework loaded into the MCP server prompt and served by
 * `dopl_skill(op='authoring_guide')`.
 *
 * ⚠ Reconciles two conflicting sources: the Agent Skills spec wants
 * descriptions carrying both *what* + *when*, while empirical work shows a
 * description that SUMMARIZES the workflow makes the agent skip the body. So: lead
 * with concrete *what*, then heavy *when*-triggers, and NEVER summarize the
 * workflow/steps in the description.
 *
 * Rendered per call, in the connection's tool set (`call-ref.ts`).
 */
export declare const skillAuthoringGuide: () => string;
