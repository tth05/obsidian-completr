import { describe, expect, spyOn, test } from "bun:test";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import { WORD_LISTS_FOLDER, WordListProvider } from "../../src/provider/word_list_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { makeContext, makeDataFiles, makeSettings, pluginPath } from "./helpers.ts";

const listPath = (name: string) => pluginPath(WORD_LISTS_FOLDER + "/" + name);

async function setup(lists: Record<string, string> = {}, blacklisted: string[] = []) {
    const { files, adapter } = makeDataFiles();
    for (const [name, text] of Object.entries(lists)) adapter.files.set(listPath(name), text);
    const blacklist = new SuggestionBlacklist(files);
    await blacklist.addAll(blacklisted);
    adapter.writes.length = 0;
    return { provider: new WordListProvider(files, blacklist), adapter, blacklist };
}

const all = (provider: WordListProvider, overrides: Partial<CompletrSettings> = {}) =>
    provider
        .getSuggestions(makeContext("", { manual: true }), makeSettings({ minWordLength: 0, ...overrides }))
        .map((s) => s.displayName)
        .sort();

describe("WordListProvider", () => {
    test("id and icon", async () => {
        const { provider } = await setup();
        expect(provider.id).toBe("word-list");
        expect(provider.icon).toBe("book-open");
    });

    test("loads all lists, one word per line", async () => {
        const { provider } = await setup({ "en.txt": "apple\nbanana", "de.txt": "Apfel\r\nBanane\r\n" });
        expect(await provider.load(makeSettings())).toBe(4);
        expect(provider.wordCount).toBe(4);
        expect(all(provider)).toEqual(["Apfel", "apple", "banana", "Banane"].sort());
    });

    test("trims lines and skips empty lines", async () => {
        const { provider } = await setup({ "a.txt": "  padded  \n\n\t\ttabbed\n   \n" });
        await provider.load(makeSettings());
        expect(all(provider)).toEqual(["padded", "tabbed"]);
    });

    test("duplicates across lists are counted once", async () => {
        const { provider } = await setup({ "a.txt": "word\nother", "b.txt": "word" });
        expect(await provider.load(makeSettings())).toBe(2);
    });

    test("skips words shorter than minWordLength", async () => {
        const { provider } = await setup({ "a.txt": "a\nab\nabc\nabcd" });
        await provider.load(makeSettings({ minWordLength: 3 }));
        expect(all(provider)).toEqual(["abc", "abcd"]);
    });

    test("skips blacklisted words", async () => {
        const { provider } = await setup({ "a.txt": "good\nbad" }, ["bad"]);
        await provider.load(makeSettings());
        expect(all(provider)).toEqual(["good"]);
    });

    test("creates the word list folder if missing", async () => {
        const { provider, adapter } = await setup();
        expect(await provider.load(makeSettings())).toBe(0);
        expect(adapter.folders.has(pluginPath(WORD_LISTS_FOLDER))).toBe(true);
    });

    test("unreadable lists are skipped with a warning", async () => {
        const { provider, adapter } = await setup({ "good.txt": "good", "bad.txt": "bad" });
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
        const { provider, adapter } = await setup({ "a.txt": "old" });
        await provider.load(makeSettings());
        adapter.files.set(listPath("a.txt"), "new");
        await provider.load(makeSettings());
        expect(all(provider)).toEqual(["new"]);
    });

    test("removeWord", async () => {
        const { provider } = await setup({ "a.txt": "keep\nremove" });
        await provider.load(makeSettings());
        provider.removeWord("remove");
        expect(all(provider)).toEqual(["keep"]);
        expect(provider.wordCount).toBe(1);
    });

    test("getFilePaths lists the files in the word list folder", async () => {
        const { provider } = await setup({ "b.txt": "", "a.txt": "" });
        expect(await provider.getFilePaths()).toEqual([listPath("a.txt"), listPath("b.txt")]);
    });

    test("importWordList writes a new list but never overwrites", async () => {
        const { provider, adapter } = await setup({ "existing.txt": "old" });
        expect(await provider.importWordList("new.txt", "a\nb")).toBe(true);
        expect(adapter.files.get(listPath("new.txt"))).toBe("a\nb");
        expect(await provider.importWordList("existing.txt", "replaced")).toBe(false);
        expect(adapter.files.get(listPath("existing.txt"))).toBe("old");
    });

    test("imported lists are used after reloading", async () => {
        const { provider } = await setup();
        await provider.importWordList("imported.txt", "imported\nwords");
        await provider.load(makeSettings());
        expect(all(provider)).toEqual(["imported", "words"]);
    });

    test("deleteWordList removes the file by vault path", async () => {
        const { provider, adapter } = await setup({ "a.txt": "x" });
        const [path] = await provider.getFilePaths();
        await provider.deleteWordList(path);
        expect(adapter.files.has(listPath("a.txt"))).toBe(false);
    });

    test("suggests by prefix and respects the enabled setting", async () => {
        const { provider } = await setup({ "a.txt": "apple\napricot\nbanana" });
        await provider.load(makeSettings());
        const settings = makeSettings();
        expect(provider.getSuggestions(makeContext("apr"), settings).map((s) => s.displayName)).toEqual(["apricot"]);
        expect(provider.getSuggestions(makeContext("apr"), makeSettings({ wordListProviderEnabled: false }))).toEqual(
            [],
        );
    });
});
