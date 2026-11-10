import { describe, expect, test } from "bun:test";
import {
    type CustomEntry,
    CustomEntryFile,
    type CustomEntryKind,
    parseCustomEntries,
    serializeCustomEntries,
} from "../../src/provider/custom_suggestions.ts";
import { makeDataFiles, pluginPath } from "./helpers.ts";

const entry = (displayName: string, replacement = displayName): CustomEntry => ({ displayName, replacement });

describe("parseCustomEntries", () => {
    test("strings are entries with the same display name and replacement", () => {
        expect(parseCustomEntries('["\\\\alpha", "\\\\frac{#}{#}"]')).toEqual([
            entry("\\alpha"),
            entry("\\frac{#}{#}"),
        ]);
    });

    test("objects with display name and replacement", () => {
        const json = JSON.stringify([{ displayName: "\\begin{x}...", replacement: "\\begin{x}\n~\n\\end{x}" }]);
        expect(parseCustomEntries(json)).toEqual([entry("\\begin{x}...", "\\begin{x}\n~\n\\end{x}")]);
    });

    test("extra properties are dropped", () => {
        const json = JSON.stringify([{ displayName: "a", replacement: "b", icon: "x", color: "red" }]);
        expect(parseCustomEntries(json)).toEqual([entry("a", "b")]);
    });

    test("mixed entries and the empty list", () => {
        expect(parseCustomEntries(JSON.stringify(["a", { displayName: "b", replacement: "c" }]))).toEqual([
            entry("a"),
            entry("b", "c"),
        ]);
        expect(parseCustomEntries("[]")).toEqual([]);
    });

    test("invalid JSON throws", () => {
        expect(() => parseCustomEntries('["a",')).toThrow();
        expect(() => parseCustomEntries("")).toThrow();
    });

    test("the root must be an array", () => {
        expect(() => parseCustomEntries('{"a": 1}')).toThrow("array");
        expect(() => parseCustomEntries('"\\\\alpha"')).toThrow("array");
        expect(() => parseCustomEntries("null")).toThrow("array");
    });

    test.each([
        ["a number", [1]],
        ["null", [null]],
        ["a missing replacement", [{ displayName: "a" }]],
        ["a missing display name", [{ replacement: "a" }]],
        ["a non-string replacement", [{ displayName: "a", replacement: 1 }]],
        ["an array", [["a", "b"]]],
    ])("rejects %s, naming the index", (_, entries) => {
        expect(() => parseCustomEntries(JSON.stringify(["ok", ...entries]))).toThrow("index 1");
    });

    test("display names must not contain a newline", () => {
        const json = JSON.stringify([{ displayName: "a\nb", replacement: "x" }]);
        expect(() => parseCustomEntries(json)).toThrow("newline");
    });

    test("string entries must not contain a newline either", () => {
        expect(() => parseCustomEntries(JSON.stringify(["a\nb"]))).toThrow("newline");
    });

    test("newlines in the replacement are fine", () => {
        expect(parseCustomEntries(JSON.stringify([{ displayName: "a", replacement: "x\ny" }]))).toEqual([
            entry("a", "x\ny"),
        ]);
    });
});

describe("serializeCustomEntries", () => {
    test("entries with equal display name and replacement are written as strings", () => {
        const json = serializeCustomEntries([entry("\\alpha"), entry("a", "b")]);
        expect(JSON.parse(json)).toEqual(["\\alpha", { displayName: "a", replacement: "b" }]);
    });

    test("is pretty printed", () => {
        expect(serializeCustomEntries([entry("a")])).toBe('[\n  "a"\n]');
        expect(serializeCustomEntries([])).toBe("[]");
    });

    test("round trip", () => {
        const entries = [
            entry("\\alpha"),
            entry("\\begin{x}...", "\\begin{x}\n~\n\\end{x}"),
            entry('"quoted"', "\\\\"),
            entry(":sig", "Kind regards,\n{{name}}\n{{cursor}}"),
        ];
        expect(parseCustomEntries(serializeCustomEntries(entries))).toEqual(entries);
    });
});

describe("CustomEntryFile", () => {
    const NAME = "things.json";
    const FILE = pluginPath(NAME);
    const BACKUP = FILE + ".broken.bak";
    const KIND: CustomEntryKind = {
        title: "Things",
        noun: ["thing", "things"],
        description: "Things for testing.",
        addTitle: "Add thing",
        editTitle: "Edit thing",
        namePlaceholder: "name",
        replacementPlaceholder: "text",
        syntaxHelp: "The inserted text.",
        nameRequired: true,
    };

    /** `changes` records the entries (as names) every time `onChange` is called. */
    function setup(contents?: string) {
        const { files, adapter } = makeDataFiles();
        if (contents !== undefined) adapter.files.set(FILE, contents);
        const changes: string[][] = [];
        const file: CustomEntryFile = new CustomEntryFile(files, NAME, KIND, () =>
            changes.push(file.entries.map((e) => e.displayName)),
        );
        return { file, adapter, changes, files };
    }

    async function loaded(...entries: CustomEntry[]) {
        const result = setup(serializeCustomEntries(entries));
        await result.file.load();
        result.changes.length = 0;
        result.adapter.writes.length = 0;
        return result;
    }

    const saved = (adapter: { files: Map<string, string> }) => parseCustomEntries(adapter.files.get(FILE)!);

    test("is empty before loading", () => {
        const { file, changes } = setup(JSON.stringify(["a"]));
        expect(file.entries).toEqual([]);
        expect(file.error).toBeNull();
        expect(changes).toEqual([]);
    });

    test("file name, kind and vault relative path", () => {
        const { file } = setup();
        expect(file.fileName).toBe(NAME);
        expect(file.kind).toBe(KIND);
        expect(file.path).toBe(FILE);
    });

    describe("load", () => {
        test("creates an empty file if it is missing", async () => {
            const { file, adapter } = setup();
            expect(await file.load()).toBeNull();
            expect(adapter.files.get(FILE)).toBe("[]");
            expect(file.entries).toEqual([]);
            expect(file.error).toBeNull();
        });

        test("reads the entries without writing", async () => {
            const { file, adapter } = setup(JSON.stringify(["a", { displayName: "b", replacement: "c" }]));
            expect(await file.load()).toBeNull();
            expect(file.entries).toEqual([entry("a"), entry("b", "c")]);
            expect(adapter.writes).toEqual([]);
        });

        test("an invalid file gives an error naming the file and no entries", async () => {
            const { file, adapter } = setup("[broken");
            const error = await file.load();
            expect(error).toContain(NAME);
            expect(file.error).toBe(error);
            expect(file.entries).toEqual([]);
            // The file is left alone
            expect(adapter.files.get(FILE)).toBe("[broken");
            expect(adapter.writes).toEqual([]);
        });

        test("the error says what is wrong", async () => {
            const { file } = setup(JSON.stringify(["ok", 42]));
            expect(await file.load()).toContain("index 1");
        });

        test("an empty file is invalid, not an empty list", async () => {
            const { file, adapter } = setup("");
            expect(await file.load()).not.toBeNull();
            expect(adapter.files.get(FILE)).toBe("");
        });

        test("reloading replaces the entries", async () => {
            const { file, adapter } = setup(JSON.stringify(["old"]));
            await file.load();
            adapter.files.set(FILE, JSON.stringify(["new"]));
            await file.load();
            expect(file.entries).toEqual([entry("new")]);
        });

        test("reloading a file that became invalid drops the entries", async () => {
            const { file, adapter } = setup(JSON.stringify(["old"]));
            await file.load();
            adapter.files.set(FILE, "{}");
            expect(await file.load()).toContain("array");
            expect(file.entries).toEqual([]);
        });

        test("reloading a repaired file clears the error", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            adapter.files.set(FILE, JSON.stringify(["fixed"]));
            expect(await file.load()).toBeNull();
            expect(file.error).toBeNull();
            expect(file.entries).toEqual([entry("fixed")]);
        });
    });

    describe("set", () => {
        test("replaces the entries and saves them", async () => {
            const { file, adapter } = await loaded(entry("old"));
            await file.set([entry("a"), entry("b", "c")]);
            expect(file.entries).toEqual([entry("a"), entry("b", "c")]);
            expect(adapter.writes).toEqual([[FILE, serializeCustomEntries([entry("a"), entry("b", "c")])]]);
        });

        test("an empty list is saved as an empty array", async () => {
            const { file, adapter } = await loaded(entry("old"));
            await file.set([]);
            expect(adapter.files.get(FILE)).toBe("[]");
        });

        test("saved entries can be loaded by another instance", async () => {
            const { file, files } = setup();
            await file.load();
            const entries = [entry(":sig", "Regards\n{{cursor}}"), entry("\\R", "\\mathbb{R}")];
            await file.set(entries);

            const other = new CustomEntryFile(files, NAME, KIND);
            expect(await other.load()).toBeNull();
            expect(other.entries).toEqual(entries);
        });
    });

    describe("add", () => {
        test("appends the entry and saves", async () => {
            const { file, adapter } = await loaded(entry("a"));
            await file.add(entry("b", "c"));
            expect(file.entries).toEqual([entry("a"), entry("b", "c")]);
            expect(saved(adapter)).toEqual([entry("a"), entry("b", "c")]);
        });

        test("does not check for duplicates", async () => {
            const { file } = await loaded(entry("a"));
            await file.add(entry("a"));
            expect(file.entries).toEqual([entry("a"), entry("a")]);
        });
    });

    describe("replace", () => {
        test("replaces the entry in place and saves", async () => {
            const { file, adapter } = await loaded(entry("a"), entry("b"), entry("c"));
            await file.replace(file.entries[1], entry("B", "new"));
            expect(file.entries).toEqual([entry("a"), entry("B", "new"), entry("c")]);
            expect(saved(adapter)).toEqual([entry("a"), entry("B", "new"), entry("c")]);
        });

        test("only replaces that entry, not others that look the same", async () => {
            const { file } = await loaded(entry("a"), entry("a"));
            await file.replace(file.entries[1], entry("b"));
            expect(file.entries).toEqual([entry("a"), entry("b")]);
        });

        test("an entry that was removed in the meantime is added instead", async () => {
            const { file, adapter } = await loaded(entry("a"), entry("b"));
            const stale = file.entries[0];
            await file.remove(stale);
            await file.replace(stale, entry("A"));
            expect(file.entries).toEqual([entry("b"), entry("A")]);
            expect(saved(adapter)).toEqual([entry("b"), entry("A")]);
        });

        test("an entry from before a reload is stale, even if the file still contains it", async () => {
            const { file } = await loaded(entry("a"), entry("b"));
            const stale = file.entries[0];
            await file.load();
            await file.replace(stale, entry("A"));
            expect(file.entries).toEqual([entry("a"), entry("b"), entry("A")]);
        });

        test("an equal object that is not one of the entries is stale as well", async () => {
            const { file } = await loaded(entry("a"));
            await file.replace(entry("a"), entry("A"));
            expect(file.entries).toEqual([entry("a"), entry("A")]);
        });

        test("the replacement can be replaced again", async () => {
            const { file } = await loaded(entry("a"));
            const first = entry("b");
            await file.replace(file.entries[0], first);
            await file.replace(first, entry("c"));
            expect(file.entries).toEqual([entry("c")]);
        });
    });

    describe("remove", () => {
        test("removes the entry and saves", async () => {
            const { file, adapter } = await loaded(entry("a"), entry("b"), entry("c"));
            await file.remove(file.entries[1]);
            expect(file.entries).toEqual([entry("a"), entry("c")]);
            expect(saved(adapter)).toEqual([entry("a"), entry("c")]);
        });

        test("only removes that entry, not others that look the same", async () => {
            const { file } = await loaded(entry("a"), entry("a"));
            await file.remove(file.entries[0]);
            expect(file.entries).toEqual([entry("a")]);
        });

        test("an entry that is not in the list removes nothing", async () => {
            const { file } = await loaded(entry("a"));
            await file.remove(entry("a"));
            expect(file.entries).toEqual([entry("a")]);
        });

        test("removing the last entry leaves an empty list", async () => {
            const { file, adapter } = await loaded(entry("a"));
            await file.remove(file.entries[0]);
            expect(file.entries).toEqual([]);
            expect(adapter.files.get(FILE)).toBe("[]");
        });
    });

    describe("onChange", () => {
        test("is called after loading, with the loaded entries available", async () => {
            const { file, changes } = setup(JSON.stringify(["a", "b"]));
            await file.load();
            expect(changes).toEqual([["a", "b"]]);
        });

        test("is called after loading a missing or an invalid file", async () => {
            const missing = setup();
            await missing.file.load();
            expect(missing.changes).toEqual([[]]);

            const broken = setup("[broken");
            await broken.file.load();
            expect(broken.changes).toEqual([[]]);
        });

        test("is called once for every change, with the new entries available", async () => {
            const { file, changes } = await loaded(entry("a"));
            await file.add(entry("b"));
            await file.replace(file.entries[0], entry("A"));
            await file.remove(file.entries[1]);
            await file.set([entry("x"), entry("y")]);
            await file.load();
            expect(changes).toEqual([["a", "b"], ["A", "b"], ["A"], ["x", "y"], ["x", "y"]]);
        });

        test("is called once when a stale entry is replaced", async () => {
            const { file, changes } = await loaded(entry("a"));
            await file.replace(entry("gone"), entry("b"));
            expect(changes).toEqual([["a", "b"]]);
        });

        test("is optional", async () => {
            const { files } = makeDataFiles();
            const file = new CustomEntryFile(files, NAME, KIND);
            await file.load();
            await file.add(entry("a"));
            expect(file.entries).toEqual([entry("a")]);
        });
    });

    describe("a file that could not be loaded", () => {
        test("is backed up by the first set, which also clears the error", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            expect(adapter.files.has(BACKUP)).toBe(false);

            await file.set([entry("a")]);
            expect(adapter.files.get(BACKUP)).toBe("[broken");
            expect(saved(adapter)).toEqual([entry("a")]);
            expect(file.error).toBeNull();
            expect(file.entries).toEqual([entry("a")]);
        });

        test("is backed up by add as well", async () => {
            const { file, adapter } = setup('["a",');
            await file.load();
            await file.add(entry("b"));
            expect(adapter.files.get(BACKUP)).toBe('["a",');
            expect(saved(adapter)).toEqual([entry("b")]);
        });

        test("is only backed up once", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            await file.set([entry("a")]);
            await file.set([entry("b")]);
            expect(adapter.files.get(BACKUP)).toBe("[broken");
            expect(adapter.writes.map(([path]) => path)).toEqual([BACKUP, FILE, FILE]);
        });

        test("the backup has what is in the file by then, not what was loaded", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            adapter.files.set(FILE, "[still broken");
            await file.set([]);
            expect(adapter.files.get(BACKUP)).toBe("[still broken");
        });

        test("no backup if the file was deleted in the meantime", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            adapter.files.delete(FILE);
            await file.set([entry("a")]);
            expect(adapter.files.has(BACKUP)).toBe(false);
            expect(saved(adapter)).toEqual([entry("a")]);
            expect(file.error).toBeNull();
        });

        test("a valid file is never backed up", async () => {
            const { file, adapter } = await loaded(entry("a"));
            await file.set([entry("b")]);
            await file.add(entry("c"));
            expect(adapter.files.has(BACKUP)).toBe(false);
        });

        test("a file that was repaired and reloaded is not backed up", async () => {
            const { file, adapter } = setup("[broken");
            await file.load();
            adapter.files.set(FILE, "[]");
            await file.load();
            await file.add(entry("a"));
            expect(adapter.files.has(BACKUP)).toBe(false);
        });
    });

    describe("countLabel", () => {
        test("uses the singular for exactly one entry", async () => {
            const { file } = setup();
            expect(file.countLabel).toBe("0 things");
            await file.load();
            expect(file.countLabel).toBe("0 things");
            await file.add(entry("a"));
            expect(file.countLabel).toBe("1 thing");
            await file.add(entry("b"));
            expect(file.countLabel).toBe("2 things");
            await file.remove(file.entries[0]);
            expect(file.countLabel).toBe("1 thing");
        });

        test("uses the nouns of the kind", () => {
            const { files } = makeDataFiles();
            const kind: CustomEntryKind = { ...KIND, noun: ["custom command", "custom commands"] };
            expect(new CustomEntryFile(files, NAME, kind).countLabel).toBe("0 custom commands");
        });
    });
});
