import { describe, expect, test } from "bun:test";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import { FileScannerProvider, scanWords } from "../../src/provider/scanner_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { makeContext, makeDataFiles, makeSettings, pluginPath, useFakeTimers } from "./helpers.ts";

const settings = makeSettings();
const scan = (text: string, overrides: Partial<CompletrSettings> = {}, excludeOffset?: number) =>
    scanWords(text, makeSettings(overrides), excludeOffset);

describe("scanWords", () => {
    test("splits text into words", () => {
        expect(scan("Hello world, this is a test.")).toEqual(["Hello", "world", "this", "is", "test"]);
    });

    test("keeps duplicates", () => {
        expect(scan("word word")).toEqual(["word", "word"]);
    });

    test("digits and punctuation separate words", () => {
        expect(scan("abc123def foo_bar baz-qux it's")).toEqual(["abc", "def", "foo", "bar", "baz", "qux", "it"]);
    });

    test("unicode words incl. combining marks", () => {
        expect(scan("Ελληνικά русский किताब नमस्ते café")).toEqual(["Ελληνικά", "русский", "किताब", "नमस्ते", "café"]);
    });

    test("minWordLength", () => {
        expect(scan("a bb ccc dddd", { minWordLength: 3 })).toEqual(["ccc", "dddd"]);
        expect(scan("a bb", { minWordLength: 0 })).toEqual(["a", "bb"]);
    });

    test("markdown formatting is not part of words", () => {
        expect(scan("**bold** _italic_ ~~strike~~ ==mark== #tag ## Heading")).toEqual([
            "bold",
            "italic",
            "strike",
            "mark",
            "tag",
            "Heading",
        ]);
    });

    describe("skipped regions", () => {
        test("inline math", () => {
            expect(scan("before $\\alpha + beta$ after")).toEqual(["before", "after"]);
        });

        test("display math, also across lines", () => {
            expect(scan("before $$\\frac{ab}{cd}$$ after")).toEqual(["before", "after"]);
            expect(scan("before\n$$\n\\sum_{inner} words\n$$\nafter")).toEqual(["before", "after"]);
        });

        test("inline code", () => {
            expect(scan("use `const value` here")).toEqual(["use", "here"]);
            expect(scan("use ``code with`` here")).toEqual(["use", "here"]);
        });

        test("inline code containing a shorter backtick run", () => {
            expect(scan("use ``code ` with`` here")).toEqual(["use", "here"]);
        });

        test("fenced code blocks", () => {
            expect(scan("before\n```js\nconst foo = bar;\n```\nafter")).toEqual(["before", "after"]);
        });

        test("URLs", () => {
            expect(scan("see https://example.com/some/path?query=value here")).toEqual(["see", "here"]);
            expect(scan("plain http://example.org")).toEqual(["plain"]);
            expect(scan("<https://example.com/abc> end")).toEqual(["end"]);
        });

        test("markdown link destinations, but not the link text", () => {
            expect(scan("a [link text](https://example.com/path) b", { minWordLength: 1 })).toEqual([
                "a",
                "link",
                "text",
                "b",
            ]);
            expect(scan("[relative](folder/some%20note.md) end")).toEqual(["relative", "end"]);
            expect(scan("![image alt](attachments/picture.png)")).toEqual(["image", "alt"]);
        });

        test("dollar amounts are not treated as math", () => {
            expect(scan("costs $5 and $6 total")).toEqual(["costs", "and", "total"]);
        });
    });

    describe("brackets and wikilinks (#99)", () => {
        test("keeps words inside [brackets]", () => {
            expect(scan("some [bracketed words] here")).toEqual(["some", "bracketed", "words", "here"]);
        });

        test("keeps words inside [[wikilinks]]", () => {
            expect(scan("see [[Some Note]] and [[Other|alias name]]")).toEqual([
                "see",
                "Some",
                "Note",
                "and",
                "Other",
                "alias",
                "name",
            ]);
        });

        test("keeps words of wikilinks with headings and embeds", () => {
            expect(scan("![[Note#Heading]]")).toEqual(["Note", "Heading"]);
        });

        test("brackets followed by text in parentheses with a space are only skipped up to the next )", () => {
            expect(scan("[text] (not a link)")).toEqual(["text", "not", "link"]);
        });
    });

    describe("excludeOffset", () => {
        const text = "hello wor done";

        test("skips the word the cursor is at the end of", () => {
            expect(scan(text, {}, 9)).toEqual(["hello", "done"]);
        });

        test("skips the word the cursor is in or at the start of", () => {
            expect(scan(text, {}, 7)).toEqual(["hello", "done"]);
            expect(scan(text, {}, 6)).toEqual(["hello", "done"]);
        });

        test("only the word touching the offset is skipped", () => {
            expect(scan(text, {}, 0)).toEqual(["wor", "done"]);
            expect(scan(text, {}, 14)).toEqual(["hello", "wor"]);
        });

        test("an offset outside of words skips nothing", () => {
            expect(scan("a  b", { minWordLength: 1 }, 2)).toEqual(["a", "b"]);
            expect(scan(text, {}, -1)).toEqual(["hello", "wor", "done"]);
            expect(scan(text, {}, 100)).toEqual(["hello", "wor", "done"]);
        });

        test("other occurrences of the same word are kept", () => {
            expect(scan("wor wor", {}, 7)).toEqual(["wor"]);
        });
    });

    describe("character regex", () => {
        test("custom character class", () => {
            expect(scan("Hello wörld", { characterRegex: "a-z" })).toEqual(["ello", "rld"]);
        });

        test("invalid character class falls back to the default", () => {
            expect(scan("Hello wörld", { characterRegex: "z-a" })).toEqual(["Hello", "wörld"]);
        });

        test("the legacy class still works", () => {
            expect(scan("Grüße café", { characterRegex: "a-zA-ZöäüÖÄÜß" })).toEqual(["Grüße", "caf"]);
        });

        test("results do not depend on previous calls (regex state is reset)", () => {
            expect(scan("one two")).toEqual(["one", "two"]);
            expect(scan("three")).toEqual(["three"]);
        });
    });
});

describe("FileScannerProvider", () => {
    const timers = useFakeTimers();

    async function setup(scannedWords?: string, blacklisted: string[] = []) {
        const { files, adapter } = makeDataFiles();
        if (scannedWords !== undefined) adapter.files.set(pluginPath("scanned_words.txt"), scannedWords);
        const blacklist = new SuggestionBlacklist(files);
        await blacklist.addAll(blacklisted);
        adapter.writes.length = 0;
        const provider = new FileScannerProvider(files, blacklist);
        await provider.load(settings);
        return { provider, adapter, blacklist };
    }

    const savedWords = (adapter: { files: Map<string, string> }) =>
        adapter.files.get(pluginPath("scanned_words.txt"))?.split("\n").sort();

    const suggestions = (provider: FileScannerProvider, query: string, overrides: Partial<CompletrSettings> = {}) =>
        provider
            .getSuggestions(makeContext(query, { manual: true }), makeSettings(overrides))
            .map((s) => s.displayName);

    test("id and icon", async () => {
        const { provider } = await setup();
        expect(provider.id).toBe("file-scanner");
        expect(provider.icon).toBe("file-search");
    });

    describe("load", () => {
        test("missing file means no words", async () => {
            const { provider } = await setup();
            expect(provider.wordCount).toBe(0);
        });

        test("loads words, ignoring empty lines, CRLF and blacklisted words", async () => {
            const { provider } = await setup("alpha\r\nbeta\n\ngamma\nbad\n", ["bad"]);
            expect(provider.wordCount).toBe(3);
            expect(suggestions(provider, "")).toEqual(["beta", "alpha", "gamma"]);
        });

        test("loading does not write anything", async () => {
            const { provider, adapter } = await setup("alpha");
            await provider.flush();
            expect(adapter.writes).toEqual([]);
            expect(timers.pending.size).toBe(0);
        });
    });

    describe("addText", () => {
        test("adds scanned words and schedules a save", async () => {
            const { provider, adapter } = await setup();
            provider.addText("Hello `code` world $math$", settings);
            expect(provider.wordCount).toBe(2);
            expect(timers.delays).toEqual([2000]);
            expect(adapter.writes).toEqual([]);

            timers.runAll();
            await Promise.resolve();
            expect(savedWords(adapter)).toEqual(["Hello", "world"]);
        });

        test("skips blacklisted words", async () => {
            const { provider } = await setup(undefined, ["world"]);
            provider.addText("hello world", settings);
            expect(suggestions(provider, "")).toEqual(["hello"]);
        });

        test("no save is scheduled if nothing changed", async () => {
            const { provider } = await setup("hello");
            provider.addText("hello a", settings);
            expect(timers.pending.size).toBe(0);
        });

        test("multiple changes share one scheduled save", async () => {
            const { provider } = await setup();
            provider.addText("one", settings);
            provider.addText("two", settings);
            provider.addText("three", settings);
            expect(timers.pending.size).toBe(1);
        });

        test("respects minWordLength", async () => {
            const { provider } = await setup();
            provider.addText("ab abc abcd", makeSettings({ minWordLength: 4 }));
            expect(suggestions(provider, "", { minWordLength: 0 })).toEqual(["abcd"]);
        });
    });

    describe("flush", () => {
        test("writes immediately and cancels the scheduled save", async () => {
            const { provider, adapter } = await setup("old");
            provider.addText("new words", settings);
            await provider.flush();
            expect(timers.pending.size).toBe(0);
            expect(savedWords(adapter)).toEqual(["new", "old", "words"]);
            expect(adapter.writes).toHaveLength(1);
        });

        test("does nothing if there are no changes", async () => {
            const { provider, adapter } = await setup("old");
            await provider.flush();
            provider.addText("new", settings);
            await provider.flush();
            await provider.flush();
            expect(adapter.writes).toHaveLength(1);
        });

        test("writes to scanned_words.txt in the plugin folder", async () => {
            const { provider, adapter } = await setup();
            provider.addText("word", settings);
            await provider.flush();
            expect(adapter.writes).toEqual([[pluginPath("scanned_words.txt"), "word"]]);
        });

        test("saved words can be loaded again", async () => {
            const first = await setup();
            first.provider.addText("Some words Ελληνικά नमस्ते", settings);
            await first.provider.flush();

            const { files } = makeDataFiles(first.adapter);
            const second = new FileScannerProvider(files, new SuggestionBlacklist(files));
            await second.load(settings);
            expect(second.wordCount).toBe(4);
            expect(second.getSuggestions(makeContext("नम"), makeSettings({ minWordTriggerLength: 1 }))).toHaveLength(1);
        });
    });

    describe("setCurrentFileText", () => {
        test("adds the current file's words to the known words", async () => {
            const { provider } = await setup("existing");
            provider.setCurrentFileText("current text", settings);
            expect(suggestions(provider, "")).toEqual(["text", "current", "existing"]);
            expect(timers.pending.size).toBe(1);
        });

        test("skips the word at the cursor", async () => {
            const { provider } = await setup();
            provider.setCurrentFileText("hello wor", settings, 9);
            expect(suggestions(provider, "")).toEqual(["hello"]);
        });

        test("with fileScannerScanCurrent off the words are only used for the current file", async () => {
            const { provider } = await setup("existing");
            const noScan = makeSettings({ fileScannerScanCurrent: false });
            provider.setCurrentFileText("current text", noScan);
            expect(provider.wordCount).toBe(1);
            expect(timers.pending.size).toBe(0);
            expect(suggestions(provider, "", { fileScannerScanCurrent: false })).toEqual(["existing"]);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual(["text", "current"]);
        });

        test("fileScannerCurrentFileOnly only suggests words of the current file", async () => {
            const { provider } = await setup("everywhere");
            provider.setCurrentFileText("only here", settings);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual(["here", "only"]);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: false })).toEqual([
                "here",
                "only",
                "everywhere",
            ]);
        });

        test("replaces the previous current file words", async () => {
            const { provider } = await setup();
            const currentOnly = { fileScannerCurrentFileOnly: true };
            provider.setCurrentFileText("first file", settings);
            provider.setCurrentFileText("second note", settings);
            expect(suggestions(provider, "", currentOnly)).toEqual(["note", "second"]);
            // The vault wide index keeps everything
            expect(provider.wordCount).toBe(4);
        });

        test("skips blacklisted words", async () => {
            const { provider } = await setup(undefined, ["secret"]);
            provider.setCurrentFileText("public secret", settings);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual(["public"]);
            expect(suggestions(provider, "")).toEqual(["public"]);
        });

        test("no save is scheduled if no new words were found", async () => {
            const { provider } = await setup("known");
            provider.setCurrentFileText("known", settings);
            expect(timers.pending.size).toBe(0);
        });
    });

    describe("removeWord", () => {
        test("removes from both indices and saves", async () => {
            const { provider, adapter } = await setup("alpha\nbeta");
            provider.setCurrentFileText("alpha", settings);
            provider.removeWord("alpha");
            expect(suggestions(provider, "")).toEqual(["beta"]);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual([]);
            await provider.flush();
            expect(savedWords(adapter)).toEqual(["beta"]);
        });

        test("removing an unknown word does not save", async () => {
            const { provider } = await setup("alpha");
            provider.removeWord("unknown");
            expect(timers.pending.size).toBe(0);
        });
    });

    test("deleteAllWords clears everything and writes an empty file", async () => {
        const { provider, adapter } = await setup("alpha\nbeta");
        provider.setCurrentFileText("gamma", settings);
        await provider.deleteAllWords();
        expect(provider.wordCount).toBe(0);
        expect(suggestions(provider, "")).toEqual([]);
        expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual([]);
        expect(adapter.files.get(pluginPath("scanned_words.txt"))).toBe("");
        expect(timers.pending.size).toBe(0);
    });

    test("disabled provider", async () => {
        const { provider } = await setup("alpha");
        expect(suggestions(provider, "", { fileScannerProviderEnabled: false })).toEqual([]);
    });
});
