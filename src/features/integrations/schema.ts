import { z } from "zod";
import { INTEGRATION_PROVIDERS } from "./types";
import { MAX_LIST_LIMIT } from "./constants";

export const ProviderSchema = z.enum(INTEGRATION_PROVIDERS);

export const ConnectInputSchema = z.object({}).passthrough();

export const ListInputSchema = z.object({
  query: z.string().max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export const PrepareFromIntegrationInputSchema = z.object({
  provider: ProviderSchema,
  object_id: z.string().min(1).max(500),
  kb_id: z.string().uuid().optional(),
  cluster_id: z.string().uuid().optional(),
});
export type PrepareFromIntegrationInput = z.infer<
  typeof PrepareFromIntegrationInputSchema
>;

export const ReadInputSchema = z.object({
  object_id: z.string().min(1).max(500),
});
export type ReadInput = z.infer<typeof ReadInputSchema>;

export const ExecuteActionInputSchema = z.object({
  action: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()),
});
export type ExecuteActionInput = z.infer<typeof ExecuteActionInputSchema>;
