/**
 * The standing rules of the channel tools, pulled on demand: the channels guide and the MCP resource
 * {@link DOCTRINE_URI} return this text, which is why rules live here and not on pushed describes.
 * Rendered per call, in the connection's tool set (`call-ref.ts`): the legacy text is frozen, the
 * granular one names the granular tools. Contracts only; `channel-doctrine-budget.test.ts` caps the
 * document and every section, per set.
 */
export declare const TENANCY_RULE = "A NAME resolves only in the container the channel lives in, and a home channel IS its own container \u2014 so an identity named by NAME from your home space or a workspace does not resolve here. Its ID does: an id resolves wherever the row lives.";
export declare const tenancyFix: () => string;
/** The MCP resource URI this text is published at. */
export declare const DOCTRINE_URI = "dopl://doctrine/channels";
/** Where the rules are; names both doors so a client that cannot read MCP resources still has the op. */
export declare const doctrinePointer: () => string;
/** `channel-law.test.ts` pins its load-bearing sentences and caps its bullets and length. */
export declare const channelLaw: () => string;
/** Caps {@link waiting} tighter than the per-section budget. */
export declare const WAITING_MAX_CHARS = 600;
/**
 * Order is the reading order (law, model, op sections, fields) and is load-bearing; the keys feed the
 * published `section=` enum. `status` is covered by `rooms`; `artifact` has no section. Each is a
 * getter: a section renders in the set of the connection reading it.
 */
export declare const DOCTRINE_SECTIONS: {
    readonly law: string;
    readonly model: string;
    readonly send: string;
    readonly read: string;
    readonly waiting: string;
    readonly manage: string;
    readonly rooms: string;
    readonly fields: string;
};
export type DoctrineSection = keyof typeof DOCTRINE_SECTIONS;
/** Derived, never restated, so the `section=` enum cannot offer a name `help` cannot answer. */
export declare const DOCTRINE_SECTION_NAMES: [DoctrineSection, ...DoctrineSection[]];
/** The whole text, assembled from the named sections so a suite can pin one by name. */
export declare const channelDoctrine: () => string;
/** One section, framed like the full document; the SECURITY sentence rides every section. */
export declare function doctrineSection(name: DoctrineSection): string;
