"use client";

import type { ComponentType } from "react";
import { ChatsDemo } from "./chats-demo";
import { KnowledgeDemo } from "./knowledge-demo";
import { OntologyDemo } from "./ontology-demo";
import { SkillsDemo } from "./skills-demo";

export interface FeatureDemoProps {
  /** True while the panel is the deck's main card; drives the timeline. */
  active?: boolean;
  /** True while the deck is hovered — pauses the timeline like the progress bar. */
  paused?: boolean;
}

/**
 * Panel id -> animated miniature. Panels without an entry (workflows —
 * its page has shipped, but the demo miniature is still TODO) render text
 * only.
 */
export const FEATURE_DEMOS: Record<string, ComponentType<FeatureDemoProps>> = {
  ontology: OntologyDemo,
  knowledge: KnowledgeDemo,
  skills: SkillsDemo,
  chats: ChatsDemo,
};
