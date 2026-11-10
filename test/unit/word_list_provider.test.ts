import { describe, expect, spyOn, test } from "bun:test";
import { WORD_LISTS_FOLDER, WordListProvider } from "../../src/provider/word_list_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { makeContext, makeDataFiles, makeSettings, pluginPath } from "./helpers.ts";

const listPath = (name: string) => pluginPath(WORD_LISTS_FOLDER + "/" + name);

function setup(lists: Record<string, string> = {}) {
    const { files, adapter } = makeDataFiles();
    for (const [name, text] of Object.entries(lists)) adapter.files.set(listPath(name), text);
    return { provider: new WordListProvider(files), adapter };
}

/** Everything the provider suggests when the popup is opened manually with nothing typed. */
const all = (provider: WordListProvider, overrides: Partial<CompletrSettings> = {}) =>
    provider
        .getSuggestions(makeContext("", { manual: true }), makeSettings({ minWordLength: 0, ...overrides }))
        .map((s) => s.displayName)
        .sort();

const suggest = (provider: WordListProvider, query: string, overrides: Partial<CompletrSettings> = {}) =>
    provider.getSuggestions(makeContext(query), makeSettings(overrides)).map((s) => s.displayName);

describe("WordListProvider", () => {
    test("id and icon", () => {
        const { provider } = setup();
        expect(provider.id).toBe("word-list");
        expect(provider.icon).toBe("book-open");
    });

    describe("load", () => {
        test("loads all lists, one word per line", async () => {
            const { provider } = setup({ "en.txt": "apple\nbanana", "de.txt": "Apfel\r\nBanane\r\n" });
            expect(await provider.load(makeSettings())).toBe(4);
            expect(provider.wordCount).toBe(4);
            expect(all(provider)).toEqual(["Apfel", "apple", "banana", "Banane"].sort());
        });

        test("trims lines and skips empty lines", async () => {
            const { provider } = setup({ "a.txt": "  padded  \n\n\t\ttabbed\n   \n" });
            await provider.load(makeSettings());
            expect(all(provider)).toEqual(["padded", "tabbed"]);
        });

        test("entries with spaces are kept as one entry", async () => {
            const { provider } = setup({ "a.txt": "New York\nad hoc" });
            await provider.load(makeSettings());
            expect(all(provider)).toEqual(["New York", "ad hoc"]);
        });

        test("duplicates across lists are counted once", async () => {
            const { provider } = setup({ "a.txt": "word\nother", "b.txt": "word" });
            expect(await provider.load(makeSettings())).toBe(2);
        });

        test("creates the word list folder if missing", async () => {
            const { provider, adapter } = setup();
            expect(await provider.load(makeSettings())).toBe(0);
            expect(adapter.folders.has(pluginPath(WORD_LISTS_FOLDER))).toBe(true);
        });

        test("does not write anything", async () => {
            const { provider, adapter } = setup({ "a.txt": "word" });
            await provider.load(makeSettings());
            expect(adapter.writes).toEqual([]);
        });

        test("unreadable lists are skipped with a warning", async () => {
            const { provider, adapter } = setup({ "good.txt": "good", "bad.txt": "bad" });
            adapter.failingReads.add(listPath("bad.txt"));
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                expect(await provider.load(makeSettings())).toBe(1);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0][0])).toContain("bad.txt");
            } finally {
                warn.mockRestore();
            }
            expect(all(provider)).toEqual(["good"]);
        });

        test("reloading replaces the previous words", async () => {
            const { provider, adapter } = setup({ "a.txt": "old" });
            await provider.load(makeSettings());
            adapter.files.set(listPath("a.txt"), "new");
            await provider.load(makeSettings());
            expect(all(provider)).toEqual(["new"]);
        });

        test("files in sub folders are not loaded", async () => {
            const { provider, adapter } = setup({ "a.txt": "top" });
            adapter.folders.add(listPath("sub"));
            adapter.files.set(listPath("sub/b.txt"), "nested");
            expect(await provider.load(makeSettings())).toBe(1);
            expect(all(provider)).toEqual(["top"]);
        });

        test("the words can be searched with the other normalization settings as well", async () => {
            const { provider } = setup({ "a.txt": "Café\ncafeteria" });
            await provider.load(makeSettings());
            expect(suggest(provider, "caf")).toEqual(["Café", "cafeteria"]);
            expect(suggest(provider, "cafe", { ignoreDiacriticsWhenFiltering: true })).toEqual(["Café", "cafeteria"]);
            expect(suggest(provider, "cafe")).toEqual(["cafeteria"]);
        });
    });

    describe("minWordLength", () => {
        test("short words are loaded and counted, whatever the setting is", async () => {
            const { provider } = setup({ "a.txt": "a\nab\nabc\nabcd" });
            expect(await provider.load(makeSettings({ minWordLength: 3 }))).toBe(4);
            expect(provider.wordCount).toBe(4);
        });

        test("short words are only suggested if the setting allows it", async () => {
            const { provider } = setup({ "a.txt": "a\nab\nabc\nabcd" });
            await provider.load(makeSettings({ minWordLength: 3 }));
            expect(all(provider, { minWordLength: 3 })).toEqual(["abc", "abcd"]);
            expect(all(provider, { minWordLength: 4 })).toEqual(["abcd"]);
            expect(all(provider, { minWordLength: 5 })).toEqual([]);
        });

        test("lowering the setting shows the short words without reloading", async () => {
            const { provider, adapter } = setup({ "a.txt": "a\nab\nabc\nabcd" });
            await provider.load(makeSettings({ minWordLength: 3 }));
            adapter.files.clear();
            expect(all(provider, { minWordLength: 2 })).toEqual(["ab", "abc", "abcd"]);
            expect(all(provider, { minWordLength: 1 })).toEqual(["a", "ab", "abc", "abcd"]);
            expect(all(provider, { minWordLength: 0 })).toEqual(["a", "ab", "abc", "abcd"]);
        });

        test("applies while typing as well", async () => {
            const { provider } = setup({ "a.txt": "ab\nabc\nabcd" });
            await provider.load(makeSettings());
            const typing = { minWordTriggerLength: 1 };
            expect(suggest(provider, "a", { ...typing, minWordLength: 2 })).toEqual(["ab", "abc", "abcd"]);
            expect(suggest(provider, "a", { ...typing, minWordLength: 4 })).toEqual(["abcd"]);
        });
    });

    test("words are not filtered by a blacklist, that is the popup's job", async () => {
        const { provider, adapter } = setup({ "a.txt": "good\nbad" });
        adapter.files.set(pluginPath("blacklisted_suggestions.txt"), "bad");
        await provider.load(makeSettings());
        expect(all(provider)).toEqual(["bad", "good"]);
    });

    describe("getFileNames", () => {
        test("lists the names of the files in the word list folder, without the folder", async () => {
            const { provider } = setup({ "b.txt": "", "a.txt": "", "Deutsch (groß).dic": "" });
            expect(await provider.getFileNames()).toEqual(["Deutsch (groß).dic", "a.txt", "b.txt"]);
        });

        test("creates the word list folder if missing", async () => {
            const { provider, adapter } = setup();
            expect(await provider.getFileNames()).toEqual([]);
            expect(adapter.folders.has(pluginPath(WORD_LISTS_FOLDER))).toBe(true);
        });

        test("does not list files outside of the folder", async () => {
            const { provider, adapter } = setup({ "a.txt": "" });
            adapter.files.set(pluginPath("scanned_words.txt"), "x");
            adapter.files.set(pluginPath("wordListsOther.txt"), "x");
            expect(await provider.getFileNames()).toEqual(["a.txt"]);
        });

        test("includes an imported list", async () => {
            const { provider } = setup({ "a.txt": "" });
            await provider.importWordList("new.txt", "x");
            expect(await provider.getFileNames()).toEqual(["a.txt", "new.txt"]);
        });
    });

    describe("importWordList", () => {
        test("writes a new list but never overwrites", async () => {
            const { provider, adapter } = setup({ "existing.txt": "old" });
            expect(await provider.importWordList("new.txt", "a\nb")).toBe(true);
            expect(adapter.files.get(listPath("new.txt"))).toBe("a\nb");
            expect(await provider.importWordList("existing.txt", "replaced")).toBe(false);
            expect(adapter.files.get(listPath("existing.txt"))).toBe("old");
        });

        test("imported lists are used after reloading", async () => {
            const { provider } = setup();
            await provider.importWordList("imported.txt", "imported\nwords");
            expect(provider.wordCount).toBe(0);
            await provider.load(makeSettings());
            expect(all(provider)).toEqual(["imported", "words"]);
        });
    });

    describe("deleteWordList", () => {
        test("removes the list with the given file name", async () => {
            const { provider, adapter } = setup({ "a.txt": "x", "b.txt": "y" });
            await provider.deleteWordList("a.txt");
            expect(adapter.files.has(listPath("a.txt"))).toBe(false);
            expect(adapter.files.has(listPath("b.txt"))).toBe(true);
            expect(await provider.getFileNames()).toEqual(["b.txt"]);
        });

        test("takes the names that getFileNames returns", async () => {
            const { provider, adapter } = setup({ "a.txt": "x", "b.txt": "y" });
            for (const name of await provider.getFileNames()) await provider.deleteWordList(name);
            expect([...adapter.files.keys()]).toEqual([]);
        });

        test("a list that does not exist is ignored", async () => {
            const { provider, adapter } = setup({ "a.txt": "x" });
            await provider.deleteWordList("missing.txt");
            expect(adapter.files.has(listPath("a.txt"))).toBe(true);
        });

        test("only looks inside the word list folder", async () => {
            const { provider, adapter } = setup();
            adapter.files.set(pluginPath("a.txt"), "not a word list");
            await provider.deleteWordList("a.txt");
            expect(adapter.files.has(pluginPath("a.txt"))).toBe(true);
        });

        test("the words stay until the lists are reloaded", async () => {
            const { provider } = setup({ "a.txt": "keep\nremove" });
            await provider.load(makeSettings());
            await provider.deleteWordList("a.txt");
            expect(provider.wordCount).toBe(2);
            expect(await provider.load(makeSettings())).toBe(0);
            expect(all(provider)).toEqual([]);
        });
    });

    test("suggests by prefix and respects the enabled setting", async () => {
        const { provider } = setup({ "a.txt": "apple\napricot\nbanana" });
        await provider.load(makeSettings());
        expect(suggest(provider, "apr")).toEqual(["apricot"]);
        expect(suggest(provider, "apr", { wordListProviderEnabled: false })).toEqual([]);
    });
});
