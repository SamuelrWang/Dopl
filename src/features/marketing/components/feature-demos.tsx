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
 * Panel id -> animated miniature. A panel without an entry renders text
 * only; today every panel in `DECK_PANELS` has one, so the lookup's
 * undefined branch is a safety net for the next panel added, not a
 * live case.
 */
export const FEATURE_DEMOS: Record<string, ComponentType<FeatureDemoProps>> = {
  ontology: OntologyDemo,
  knowledge: KnowledgeDemo,
  skills: SkillsDemo,
  chats: ChatsDemo,
};
