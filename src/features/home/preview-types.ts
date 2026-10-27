import { z } from "zod";

/**
 * `GET /api/home/preview` — per-account seeded demo content (`account_preview_data`) for /home
 * cards whose real source does not exist yet. Every part is optional: a card draws its preview only
 * when its part is present, otherwise it behaves as it does with no preview at all.
 *
 * Parsing is forgiving by design: an invalid item is dropped from its list and an invalid part is
 * dropped whole, so a bad seed hides one card rather than failing the read.
 */

/** A list that keeps the items its schema accepts and drops the rest. */
function lenientList<T extends z.ZodType>(item: T) {
  return z.array(z.unknown()).transform((items) =>
    items.flatMap((raw) => {
      const parsed = item.safeParse(raw);
      return parsed.success ? [parsed.data as z.output<T>] : [];
    })
  );
}

const text = z.string().trim().min(1).max(200);
const instant = z.iso.datetime({ offset: true });
const presence = z.enum(["online", "away", "offline"]);

const PreviewAgentSchema = z.object({
  id: text,
  name: text,
  channelName: text,
  runtime: text,
  runningMinutes: z.number().int().min(0),
  state: z.enum(["working", "waiting"]),
});

const PreviewHostSchema = z.object({
  /** A real device's id or name, so the group heads the same computer the Devices card lists. */
  device: text,
  name: text,
  status: presence,
  thisComputer: z.boolean().optional(),
  agents: lenientList(PreviewAgentSchema),
});

const PreviewRouteSchema = z.object({
  id: text,
  at: instant,
  kind: z.enum(["Question", "Message", "Decision", "Notice"]),
  from: text,
  summary: text,
  /** Device names tried in order; the last is where it landed. */
  tried: z.array(text).min(1),
  why: text.optional(),
});

const PreviewLogSchema = z.object({
  id: text,
  at: instant,
  device: text,
  level: z.enum(["info", "warn", "error"]),
  event: text,
  detail: text,
});

/**
 * Detail laid over a Devices row whose id or name is `device`. An entry that matches no real row
 * and names a `kind` is listed as its own row (a device with no product source yet, e.g. a phone).
 */
const PreviewDeviceSchema = z.object({
  device: text,
  kind: text.optional(),
  model: text.optional(),
  through: text.optional(),
  inUse: z.boolean().optional(),
  battery: z.number().int().min(0).max(100).optional(),
  status: presence.optional(),
});

const PreviewNeedSchema = z.object({
  id: text,
  kind: z.enum(["approval", "question"]),
  ask: text,
  agent: text,
  host: text.optional(),
  channelName: text,
  at: instant,
});

const AddDeviceSchema = z.object({
  pairingCode: z.string().trim().regex(/^[A-Z0-9]{4,8}$/),
});

export const OverviewPreviewSchema = z
  .object({
    hosts: lenientList(PreviewHostSchema).optional().catch(undefined),
    routes: lenientList(PreviewRouteSchema).optional().catch(undefined),
    logs: lenientList(PreviewLogSchema).optional().catch(undefined),
    /** Device names, the order a message walks when the device in hand does not answer. */
    reachOrder: z.array(text).min(1).optional().catch(undefined),
    reachWaitSeconds: z.number().int().min(1).max(600).optional().catch(undefined),
    devices: lenientList(PreviewDeviceSchema).optional().catch(undefined),
    addDevice: AddDeviceSchema.optional().catch(undefined),
    needs: lenientList(PreviewNeedSchema).optional().catch(undefined),
  })
  .catch({});

export type PreviewAgent = z.output<typeof PreviewAgentSchema>;
export type PreviewHost = z.output<typeof PreviewHostSchema>;
export type PreviewRoute = z.output<typeof PreviewRouteSchema>;
export type PreviewLog = z.output<typeof PreviewLogSchema>;
export type PreviewDevice = z.output<typeof PreviewDeviceSchema>;
export type PreviewNeed = z.output<typeof PreviewNeedSchema>;
export type PreviewPresence = z.output<typeof presence>;
export type OverviewPreview = z.output<typeof OverviewPreviewSchema>;

const IdentityToolSchema = z.object({
  name: text,
  access: z.enum(["read", "write", "ask"]).optional(),
  detail: text.optional(),
});

const IdentityEscalationSchema = z.object({
  when: text,
  to: text,
});

const IdentityActionSchema = z.object({
  at: instant,
  action: text,
  permission: z.enum(["allowed", "asked", "denied"]),
  channelName: text,
});

const IdentityPreviewSchema = z
  .object({
    /** The identity this entry dresses, by id; `name` matches when the id is absent. */
    identityId: z.string().uuid().optional(),
    name: text.optional(),
    channels: lenientList(z.object({ id: text, name: text })).default([]),
    tools: lenientList(IdentityToolSchema).default([]),
    rules: lenientList(text).default([]),
    escalations: lenientList(IdentityEscalationSchema).default([]),
    actionLog: lenientList(IdentityActionSchema).default([]),
    reauth: z
      .object({ runtime: text, state: z.enum(["signed_out", "expired"]) })
      .nullable()
      .default(null),
  })
  .refine((entry) => entry.identityId !== undefined || entry.name !== undefined);

export const IdentitiesPreviewSchema = z
  .object({ identities: lenientList(IdentityPreviewSchema) })
  .catch({ identities: [] });

export type IdentityPreview = z.output<typeof IdentityPreviewSchema>;
export type IdentitiesPreview = z.output<typeof IdentitiesPreviewSchema>;

export interface HomePreview {
  overview: OverviewPreview | null;
  identities: IdentitiesPreview | null;
}

export const HOME_PREVIEW_PATH = "/api/home/preview";
export const EMPTY_PREVIEW_LIST: readonly never[] = Object.freeze([]);
