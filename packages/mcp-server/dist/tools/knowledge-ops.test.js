"use strict";
/**
 * `dopl_kb` folder-description / entry-excerpt surfacing (Feature C).
 *
 * Locks the two behaviors this feature added on top of the parity guard:
 *   1. get_tree / list_dir render each row's description/excerpt inline,
 *      flattened to one line and truncated (~120 chars, ellipsis); the
 *      separator only appears when a summary exists.
 *   2. create_folder threads `description`, write_file threads `excerpt`
 *      through to the @dopl/client calls.
 *
 * The client is a hand-rolled stub — only the methods each op touches are
 * implemented, so the tests never make a network call.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const knowledge_ops_read_js_1 = require("./knowledge-ops-read.js");
const knowledge_ops_write_js_1 = require("./knowledge-ops-write.js");
const BASE = {
    id: "base-1",
    workspaceId: "ws-1",
    name: "My Base",
    slug: "my-base",
    publicId: "pub-1",
    description: null,
    agentWriteEnabled: true,
    visibility: "public",
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
};
function folder(over) {
    return {
        id: "f1",
        workspaceId: "ws-1",
        knowledgeBaseId: "base-1",
        parentId: null,
        name: "Folder",
        description: null,
        position: 0,
        createdBy: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
        ...over,
    };
}
function entry(over) {
    return {
        id: "e1",
        workspaceId: "ws-1",
        knowledgeBaseId: "base-1",
        folderId: null,
        title: "Entry",
        excerpt: null,
        body: "",
        entryType: "note",
        position: 0,
        createdBy: "u1",
        lastEditedBy: null,
        lastEditedSource: "agent",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
        ...over,
    };
}
function textOf(res) {
    return res.content.map((c) => c.text).join("\n");
}
(0, vitest_1.describe)("get_tree renders folder descriptions + entry excerpts", () => {
    (0, vitest_1.it)("shows `— summary`, flattens newlines, and truncates long text", async () => {
        const longDesc = "a".repeat(200);
        const client = {
            listKbBases: vitest_1.vi.fn().mockResolvedValue([BASE]),
            getKbTree: vitest_1.vi.fn().mockResolvedValue({
                base: BASE,
                folders: [
                    folder({ id: "f-long", name: "Deep", description: longDesc }),
                    folder({ id: "f-multi", name: "Notes", description: "line1\nline2" }),
                    folder({ id: "f-bare", name: "Empty", description: null }),
                ],
                entries: [
                    entry({ id: "e-desc", title: "Guide", excerpt: "how to X", folderId: null }),
                    entry({ id: "e-bare", title: "Plain", excerpt: null, folderId: null }),
                ],
                entryTotal: 2,
            }),
        };
        const out = textOf(await (0, knowledge_ops_read_js_1.opGetTree)(client, "my-base"));
        // Long folder description truncated to 119 chars + ellipsis (cap 120).
        (0, vitest_1.expect)(out).toContain(`📁 Deep/ — ${"a".repeat(119)}…`);
        (0, vitest_1.expect)(out).not.toContain("a".repeat(200));
        // Newlines flattened to a single space.
        (0, vitest_1.expect)(out).toContain("📁 Notes/ — line1 line2");
        // Bare folder: name only, no separator.
        (0, vitest_1.expect)(out).toContain("📁 Empty/");
        (0, vitest_1.expect)(out).not.toContain("Empty/ —");
        // Entry excerpt surfaced; bare entry has no separator.
        (0, vitest_1.expect)(out).toContain("📄 Guide — how to X");
        (0, vitest_1.expect)(out).toContain("📄 Plain");
        (0, vitest_1.expect)(out).not.toContain("Plain —");
    });
});
(0, vitest_1.describe)("list_dir renders folder descriptions + entry excerpts", () => {
    (0, vitest_1.it)("shows `— summary` on rows and truncates long text", async () => {
        const longDesc = "b".repeat(150);
        const client = {
            listKbBases: vitest_1.vi.fn().mockResolvedValue([BASE]),
            listKbDirByPath: vitest_1.vi.fn().mockResolvedValue({
                folder: null,
                folders: [folder({ id: "f-long", name: "Deep", description: longDesc })],
                entries: [entry({ id: "e-desc", title: "Guide", excerpt: "short" })],
            }),
        };
        const out = textOf(await (0, knowledge_ops_read_js_1.opListDir)(client, "my-base", ""));
        (0, vitest_1.expect)(out).toContain(`📁 Deep/ — ${"b".repeat(119)}…`);
        (0, vitest_1.expect)(out).toContain("📄 Guide — short");
    });
});
(0, vitest_1.describe)("write paths thread the new args", () => {
    (0, vitest_1.it)("create_folder forwards `description` (and undefined when omitted)", async () => {
        const create = vitest_1.vi
            .fn()
            .mockResolvedValue(folder({ id: "f-new", name: "foo" }));
        const client = {
            listKbBases: vitest_1.vi.fn().mockResolvedValue([BASE]),
            createKbFolderByPath: create,
        };
        await (0, knowledge_ops_write_js_1.opCreateFolder)(client, "my-base", "foo", "a summary");
        (0, vitest_1.expect)(create).toHaveBeenCalledWith("base-1", "foo", "a summary");
        await (0, knowledge_ops_write_js_1.opCreateFolder)(client, "my-base", "bar");
        (0, vitest_1.expect)(create).toHaveBeenLastCalledWith("base-1", "bar", undefined);
    });
    (0, vitest_1.it)("write_file forwards `excerpt` in the write input", async () => {
        const write = vitest_1.vi.fn().mockResolvedValue({
            entry: entry({ id: "e-new", title: "notes", excerpt: "sum" }),
            webUrl: "https://app/entry",
        });
        const client = {
            listKbBases: vitest_1.vi.fn().mockResolvedValue([BASE]),
            writeKbFileByPath: write,
        };
        await (0, knowledge_ops_write_js_1.opWriteFile)(client, "my-base", "notes.md", "body text", undefined, undefined, undefined, "sum");
        (0, vitest_1.expect)(write).toHaveBeenCalledWith("base-1", "notes.md", { body: "body text", title: undefined, excerpt: "sum" }, undefined);
    });
});
