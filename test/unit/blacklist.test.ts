import { describe, expect, test } from "bun:test";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import { makeDataFiles, pluginPath } from "./helpers.ts";

const FILE = pluginPath("blacklisted_suggestions.txt");

function setup(contents?: string) {
    const { files, adapter } = makeDataFiles();
    if (contents !== undefined) adapter.files.set(FILE, contents);
    return { blacklist: new SuggestionBlacklist(files), adapter };
}

describe("SuggestionBlacklist", () => {
    test("starts empty", () => {
        const { blacklist } = setup();
        expect(blacklist.size).toBe(0);
        expect(blacklist.values()).toEqual([]);
        expect(blacklist.has("x")).toBe(false);
    });

    test("add stores the entry and saves", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.add("foo");
        await blacklist.add("\\alpha");
        expect(blacklist.has("foo")).toBe(true);
        expect(blacklist.has("Foo")).toBe(false);
        expect(blacklist.size).toBe(2);
        expect(adapter.files.get(FILE)).toBe("foo\n\\alpha");
    });

    test("adding an existing or empty entry does not save", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.add("foo");
        await blacklist.add("foo");
        await blacklist.add("");
        expect(adapter.writes).toHaveLength(1);
        expect(blacklist.has("")).toBe(false);
    });

    test("addAll saves once and skips empty and known entries", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.add("a");
        await blacklist.addAll(["a", "", "b", "c", "b"]);
        expect(blacklist.values()).toEqual(["a", "b", "c"]);
        expect(adapter.writes).toHaveLength(2);
        expect(adapter.files.get(FILE)).toBe("a\nb\nc");
    });

    test("addAll without new entries does not save", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.addAll([]);
        await blacklist.addAll([""]);
        expect(adapter.writes).toHaveLength(0);
    });

    test("addAll accepts any iterable", async () => {
        const { blacklist } = setup();
        await blacklist.addAll(new Set(["x", "y"]));
        expect(blacklist.size).toBe(2);
    });

    test("remove deletes the entry and saves", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.addAll(["a", "b"]);
        await blacklist.remove("a");
        expect(blacklist.values()).toEqual(["b"]);
        expect(adapter.files.get(FILE)).toBe("b");
        await blacklist.remove("unknown");
        expect(adapter.writes).toHaveLength(2);
    });

    test("removing the last entry writes an empty file", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.add("a");
        await blacklist.remove("a");
        expect(adapter.files.get(FILE)).toBe("");
    });

    test("load reads one entry per line, ignoring empty lines and CRLF", async () => {
        const { blacklist } = setup("foo\r\nbar\n\n \\alpha\n");
        await blacklist.load();
        expect(blacklist.values()).toEqual(["foo", "bar", " \\alpha"]);
    });

    test("load without a file leaves the blacklist empty", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.load();
        expect(blacklist.size).toBe(0);
        expect(adapter.writes).toHaveLength(0);
    });

    test("load replaces the current entries", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.add("old");
        adapter.files.set(FILE, "new");
        await blacklist.load();
        expect(blacklist.values()).toEqual(["new"]);
    });

    test("saved entries can be loaded again", async () => {
        const { blacklist, adapter } = setup();
        await blacklist.addAll(["a b", "\\begin{align}...", "Ελληνικά"]);
        const { files } = makeDataFiles(adapter);
        const other = new SuggestionBlacklist(files);
        await other.load();
        expect(other.values()).toEqual(["a b", "\\begin{align}...", "Ελληνικά"]);
    });
});
