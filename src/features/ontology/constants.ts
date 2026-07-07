import type { ObjectTypeId, ObjectTypeMeta } from "./types";

export const OBJECT_TYPES: Record<ObjectTypeId, ObjectTypeMeta> = {
  person: { id: "person", label: "Person", border: "#2c5f9e", bg: "#e8f0fb", text: "#2c5f9e" },
  team: { id: "team", label: "Team", border: "#25784a", bg: "#e5f4ec", text: "#25784a" },
  client: { id: "client", label: "Client", border: "#a1620e", bg: "#fdf1df", text: "#a1620e" },
  policy: { id: "policy", label: "Policy", border: "#6d3fb0", bg: "#f0e9fb", text: "#6d3fb0" },
  document: { id: "document", label: "Document", border: "#54595f", bg: "#eef0f2", text: "#54595f" },
};
