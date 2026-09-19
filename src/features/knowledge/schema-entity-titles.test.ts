/**
 * S35 — entity-escaped titles/names are decoded ONCE, at the schema boundary,
 * BEFORE the charset and length rules that guard them.
 *
 * The two things that can go wrong here are opposite and both silent: decoding
 * too little (the stored `R&amp;D` this fixes) and decoding too much (a loop
 * that turns `&amp;lt;` into `<`, rewriting a title somebody typed on purpose).
 */

import { describe, it, expect } from "vitest";
import {
  decodeHtmlEntities,
  EntryTitleSchema,
  KnowledgeBaseCreateSchema,
  KnowledgeEntryCreateSchema,
  KnowledgeEntryUpdateSchema,
  KnowledgeFolderCreateSchema,
  KnowledgeFolderUpdateSchema,
  ChannelLaneEntryUpdateSchema,
} from "./schema";

describe("decodeHtmlEntities — the exact entity set", () => {
  it("decodes the five named forms", () => {
    expect(decodeHtmlEntities("a&amp;b")).toBe("a&b");
    expect(decodeHtmlEntities("a&lt;b&gt;c")).toBe("a<b>c");
    expect(decodeHtmlEntities("say &quot;hi&quot;")).toBe('say "hi"');
    expect(decodeHtmlEntities("it&apos;s")).toBe("it's");
  });

  it("decodes decimal and hex numeric forms, including zero-padded", () => {
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
    expect(decodeHtmlEntities("it&#039;s")).toBe("it's");
    expect(decodeHtmlEntities("it&#x27;s")).toBe("it's");
    expect(decodeHtmlEntities("it&#X27;s")).toBe("it's");
    expect(decodeHtmlEntities("caf&#233;")).toBe("café");
    expect(decodeHtmlEntities("&#128512;")).toBe("\u{1F600}");
  });

  it("is ONE PASS — it never re-scans what it substituted", () => {
    // The whole rule: `&amp;lt;` is the literal text `&lt;`, NOT `<`. A loop
    // "until stable" would hand back `<` and rewrite the user's title.
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeHtmlEntities("a&amp;b&amp;lt;c")).toBe("a&b&lt;c");
  });

  it("leaves non-entities, unknown names and malformed code points alone", () => {
    expect(decodeHtmlEntities("R&D")).toBe("R&D");
    expect(decodeHtmlEntities("a & b; c")).toBe("a & b; c");
    expect(decodeHtmlEntities("&nbsp;")).toBe("&nbsp;");
    expect(decodeHtmlEntities("&amp")).toBe("&amp");
    // Zero, lone surrogate, past U+10FFFF — `fromCodePoint` throws on the last
    // two, so the guard is what keeps a malformed title from 500ing.
    expect(decodeHtmlEntities("&#0;")).toBe("&#0;");
    expect(decodeHtmlEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeHtmlEntities("&#1114112;")).toBe("&#1114112;");
  });

  it("is a no-op on text that carries no entity", () => {
    expect(decodeHtmlEntities("")).toBe("");
    expect(decodeHtmlEntities("Quarterly plan")).toBe("Quarterly plan");
  });
});

describe("the decode runs BEFORE NAME_RE and the length cap", () => {
  it("normalizes the title on create, update, the guest lane and the folder", () => {
    expect(
      KnowledgeEntryCreateSchema.parse({
        knowledgeBaseId: "11111111-1111-4111-8111-111111111111",
        title: "R&amp;D notes",
      }).title
    ).toBe("R&D notes");
    expect(KnowledgeEntryUpdateSchema.parse({ title: "R&amp;D" }).title).toBe("R&D");
    expect(ChannelLaneEntryUpdateSchema.parse({ title: "R&amp;D" }).title).toBe("R&D");
    expect(
      KnowledgeFolderCreateSchema.parse({
        knowledgeBaseId: "11111111-1111-4111-8111-111111111111",
        name: "R&amp;D",
      }).name
    ).toBe("R&D");
    expect(KnowledgeFolderUpdateSchema.parse({ name: "R&amp;D" }).name).toBe("R&D");
    expect(KnowledgeBaseCreateSchema.parse({ name: "R&amp;D" }).name).toBe("R&D");
  });

  it("REJECTS an entity that decodes into a banned character", () => {
    // `&#10;` and `&#x200B;` are exactly what NAME_RE exists to keep out. A
    // decode that ran after the regex would store the newline the check had
    // just certified absent.
    expect(EntryTitleSchema.safeParse("two&#10;lines").success).toBe(false);
    expect(EntryTitleSchema.safeParse("hidden&#x200B;dup").success).toBe(false);
    expect(KnowledgeBaseCreateSchema.safeParse({ name: "a&#10;b" }).success).toBe(false);
  });

  it("REJECTS a decoded '/' — the path separator, not a title character", () => {
    expect(EntryTitleSchema.safeParse("a&#47;b").success).toBe(false);
  });

  it("measures the caps and the trim against the DECODED value", () => {
    // 60 × `&amp;` is 300 wire characters and 60 stored ones.
    expect(EntryTitleSchema.parse("&amp;".repeat(60))).toBe("&".repeat(60));
    // …while 301 stored characters still fail, decoded or not.
    expect(EntryTitleSchema.safeParse("a".repeat(301)).success).toBe(false);
    // `safeLabel` trims; decoding first means a decoded space is trimmed too.
    expect(KnowledgeBaseCreateSchema.parse({ name: "&#32;Plans&#32;" }).name).toBe("Plans");
  });

  it("still rejects an empty title and one that decodes to nothing visible", () => {
    expect(EntryTitleSchema.safeParse("").success).toBe(false);
    expect(KnowledgeBaseCreateSchema.safeParse({ name: "&#32;" }).success).toBe(false);
  });
});
