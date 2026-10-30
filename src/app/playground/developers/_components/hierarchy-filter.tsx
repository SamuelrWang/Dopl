"use client";

/** Category, then integration, then model: the three cascading filters every list and chart shares. */
import { CATEGORIES, INTEGRATIONS, categoryOf, integrationOf, type ModelId } from "../_data/catalog";
import { Filter } from "./ui";

export interface Hierarchy {
  category: string;
  integration: string;
  model: string;
}

export const ALL_LEVELS: Hierarchy = { category: "all", integration: "all", model: "all" };

export function matchesHierarchy(modelId: ModelId | null, f: Hierarchy): boolean {
  if (f.category === "all" && f.integration === "all" && f.model === "all") return true;
  if (!modelId) return false;
  if (f.category !== "all" && categoryOf(modelId).id !== f.category) return false;
  if (f.integration !== "all" && integrationOf(modelId).id !== f.integration) return false;
  return f.model === "all" || modelId === f.model;
}

export function HierarchyFilter({ value, onChange }: { value: Hierarchy; onChange: (next: Hierarchy) => void }) {
  const integrations = INTEGRATIONS.filter((i) => value.category === "all" || i.categoryId === value.category);
  const models = integrations.filter((i) => value.integration === "all" || i.id === value.integration).flatMap((i) => i.models);
  return (
    <>
      <Filter
        label="Category"
        value={value.category}
        options={[{ value: "all", label: "All" }, ...CATEGORIES.map((c) => ({ value: c.id as string, label: c.name }))]}
        onChange={(category) => onChange({ category, integration: "all", model: "all" })}
      />
      <Filter
        label="Integration"
        value={value.integration}
        options={[{ value: "all", label: "All" }, ...integrations.map((i) => ({ value: i.id as string, label: i.name }))]}
        onChange={(integration) => onChange({ ...value, integration, model: "all" })}
      />
      <Filter
        label="Model"
        value={value.model}
        options={[{ value: "all", label: "All" }, ...models.map((m) => ({ value: m.id as string, label: m.name }))]}
        onChange={(model) => onChange({ ...value, model })}
      />
    </>
  );
}
