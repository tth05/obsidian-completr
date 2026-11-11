import { describe, expect, spyOn, test } from "bun:test";
import type { TFile, Vault } from "obsidian";
import { FileScannerProvider, scanWords } from "../../src/provider/scanner_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { flushPromises, makeContext, makeDataFiles, makeSettings, pluginPath, useFakeTimers } from "./helpers.ts";

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

    const WORDS_FILE = pluginPath("scanned_words.txt");

    async function setup(scannedWords?: string) {
        const { files, adapter } = makeDataFiles();
        if (scannedWords !== undefined) adapter.files.set(WORDS_FILE, scannedWords);
        const provider = new FileScannerProvider(files);
        await provider.load(settings);
        return { provider, adapter };
    }

    const savedWords = (adapter: { files: Map<string, string> }) => adapter.files.get(WORDS_FILE)?.split("\n").sort();

    /** A vault with the given notes (path -> text). Notes without text can't be read. `read` records the reads. */
    function fakeVault(notes: Record<string, string | null>) {
        const read: string[] = [];
        const vault = {
            cachedRead(file: TFile): Promise<string> {
                read.push(file.path);
                const text = notes[file.path];
                return text === null ? Promise.reject(new Error("EACCES: " + file.path)) : Promise.resolve(text);
            },
        } as unknown as Vault;
        const files = Object.keys(notes).map((path) => ({ path }) as TFile);
        return { vault, files, read };
    }

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

        test("loads words, ignoring empty lines and CRLF", async () => {
            const { provider } = await setup("alpha\r\nbeta\n\ngamma\n");
            expect(provider.wordCount).toBe(3);
            expect(suggestions(provider, "")).toEqual(["beta", "alpha", "gamma"]);
        });

        test("loads words shorter than minWordLength, they are just not suggested", async () => {
            const { provider } = await setup("a\nab\nabc");
            expect(provider.wordCount).toBe(3);
            expect(suggestions(provider, "", { minWordLength: 3 })).toEqual(["abc"]);
            expect(suggestions(provider, "", { minWordLength: 1 })).toEqual(["a", "ab", "abc"]);
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

        test("words that occur several times are added once", async () => {
            const { provider } = await setup();
            provider.addText("hello world hello Hello", settings);
            expect(provider.wordCount).toBe(3);
            expect(suggestions(provider, "").sort()).toEqual(["Hello", "hello", "world"]);
        });

        test("a big note is added at once and found like words that were added one by one", async () => {
            const { provider } = await setup("alpha\nbeta");
            expect(suggestions(provider, "al")).toEqual(["alpha"]);

            // "zzaa", "zzab", ..., "zzln": more than WordIndex inserts one by one
            const letter = (i: number) => String.fromCharCode(97 + i);
            const words = Array.from({ length: 300 }, (_, i) => "zz" + letter(Math.floor(i / 26)) + letter(i % 26));
            provider.addText(words.join(" "), settings);
            expect(provider.wordCount).toBe(302);
            expect(suggestions(provider, "zza")).toEqual(words.slice(0, 26));
            expect(suggestions(provider, "zzl")).toEqual(words.slice(286));
            expect(suggestions(provider, "al")).toEqual(["alpha"]);
            expect(suggestions(provider, "be")).toEqual(["beta"]);

            // ... and small additions afterwards are found as well
            provider.addText("alpine zzzz", settings);
            expect(suggestions(provider, "alp")).toEqual(["alpha", "alpine"]);
            expect(suggestions(provider, "zzz")).toEqual(["zzzz"]);
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
            const second = new FileScannerProvider(files);
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

        test("no save is scheduled if no new words were found", async () => {
            const { provider } = await setup("known");
            provider.setCurrentFileText("known", settings);
            expect(timers.pending.size).toBe(0);
        });

        test("does nothing if the provider is disabled", async () => {
            const { provider, adapter } = await setup("existing");
            const disabled = makeSettings({ fileScannerProviderEnabled: false });
            provider.setCurrentFileText("current text", disabled);
            expect(provider.wordCount).toBe(1);
            expect(timers.pending.size).toBe(0);
            await provider.flush();
            expect(adapter.writes).toEqual([]);
            // Not remembered for when the provider is enabled again either
            expect(suggestions(provider, "")).toEqual(["existing"]);
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual([]);
        });

        test("a disabled provider keeps the words of the note that was current before", async () => {
            const { provider } = await setup();
            provider.setCurrentFileText("first note", settings);
            provider.setCurrentFileText("second file", makeSettings({ fileScannerProviderEnabled: false }));
            expect(suggestions(provider, "", { fileScannerCurrentFileOnly: true })).toEqual(["note", "first"]);
            expect(provider.wordCount).toBe(2);
        });
    });

    describe("scanFiles", () => {
        test("learns the words of all notes and returns how many were read", async () => {
            const { provider } = await setup("existing");
            const { vault, files, read } = fakeVault({
                "a.md": "alpha beta",
                "folder/b.md": "beta gamma `code` $math$",
                "empty.md": "",
            });
            expect(await provider.scanFiles(vault, files, settings)).toBe(3);
            expect(read).toEqual(["a.md", "folder/b.md", "empty.md"]);
            expect(provider.wordCount).toBe(4);
            expect(suggestions(provider, "").sort()).toEqual(["alpha", "beta", "existing", "gamma"]);
        });

        test("the words are saved when it is done, not after the delay", async () => {
            const { provider, adapter } = await setup("existing");
            const { vault, files } = fakeVault({ "a.md": "alpha beta", "b.md": "gamma" });
            await provider.scanFiles(vault, files, settings);
            expect(savedWords(adapter)).toEqual(["alpha", "beta", "existing", "gamma"]);
            expect(adapter.writes).toHaveLength(1);
            expect(timers.pending.size).toBe(0);
        });

        test("an unreadable note is skipped with a warning", async () => {
            const { provider, adapter } = await setup();
            const { vault, files, read } = fakeVault({ "a.md": "alpha", "locked.md": null, "c.md": "gamma" });
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                expect(await provider.scanFiles(vault, files, settings)).toBe(2);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0][0])).toContain("locked.md");
            } finally {
                warn.mockRestore();
            }
            // The notes after it are still scanned
            expect(read).toEqual(["a.md", "locked.md", "c.md"]);
            expect(savedWords(adapter)).toEqual(["alpha", "gamma"]);
        });

        test("only unreadable notes", async () => {
            const { provider, adapter } = await setup();
            const { vault, files } = fakeVault({ "a.md": null, "b.md": null });
            const warn = spyOn(console, "warn").mockImplementation(() => {});
            try {
                expect(await provider.scanFiles(vault, files, settings)).toBe(0);
                expect(warn).toHaveBeenCalledTimes(2);
            } finally {
                warn.mockRestore();
            }
            expect(provider.wordCount).toBe(0);
            expect(adapter.writes).toEqual([]);
        });

        test("no notes", async () => {
            const { provider, adapter } = await setup();
            const { vault } = fakeVault({});
            expect(await provider.scanFiles(vault, [], settings)).toBe(0);
            expect(adapter.writes).toEqual([]);
        });

        test("notes without new words are counted, but nothing is written", async () => {
            const { provider, adapter } = await setup("alpha\nbeta");
            const { vault, files } = fakeVault({ "a.md": "alpha beta", "b.md": "a $x$ 123" });
            expect(await provider.scanFiles(vault, files, settings)).toBe(2);
            expect(adapter.writes).toEqual([]);
            expect(timers.pending.size).toBe(0);
        });

        test("only the given notes are read", async () => {
            const { provider } = await setup();
            const { vault, files, read } = fakeVault({ "a.md": "alpha", "b.md": "beta", "c.md": "gamma" });
            expect(await provider.scanFiles(vault, [files[2], files[0]], settings)).toBe(2);
            expect(read).toEqual(["c.md", "a.md"]);
            expect(suggestions(provider, "").sort()).toEqual(["alpha", "gamma"]);
        });

        test("uses the given settings to find words", async () => {
            const { provider } = await setup();
            const { vault, files } = fakeVault({ "a.md": "ab abc abcd x1y2z" });
            await provider.scanFiles(vault, files, makeSettings({ minWordLength: 3, characterRegex: "a-z0-9" }));
            expect(suggestions(provider, "", { minWordLength: 0 }).sort()).toEqual(["abc", "abcd", "x1y2z"]);
        });

        test("words that were waiting to be saved are saved with it", async () => {
            const { provider, adapter } = await setup();
            provider.addText("pending", settings);
            expect(timers.pending.size).toBe(1);
            const { vault, files } = fakeVault({ "a.md": "alpha" });
            await provider.scanFiles(vault, files, settings);
            expect(savedWords(adapter)).toEqual(["alpha", "pending"]);
            expect(timers.pending.size).toBe(0);
        });

        test("words of many notes are all found afterwards", async () => {
            const { provider, adapter } = await setup("alpha");
            expect(suggestions(provider, "al")).toEqual(["alpha"]);
            const letter = (i: number) => String.fromCharCode(97 + i);
            const notes: Record<string, string> = {};
            // "alqaa", ..., "alqpj" ("alp..." would contain "alpha" itself)
            for (let i = 0; i < 400; i++) notes[`note${i}.md`] = "alq" + letter(Math.floor(i / 26)) + letter(i % 26);
            const { vault, files } = fakeVault(notes);

            expect(await provider.scanFiles(vault, files, settings)).toBe(400);
            expect(provider.wordCount).toBe(401);
            expect(suggestions(provider, "alqp")).toEqual(Array.from({ length: 10 }, (_, i) => "alqp" + letter(i)));
            expect(suggestions(provider, "alph")).toEqual(["alpha"]);
            expect(savedWords(adapter)).toHaveLength(401);
        });

        test("rejects if the words can't be saved, they are saved by the next flush", async () => {
            const { provider, adapter } = await setup();
            const { vault, files } = fakeVault({ "a.md": "alpha" });
            adapter.failingWrites.add(WORDS_FILE);
            await expect(provider.scanFiles(vault, files, settings)).rejects.toThrow("ENOSPC");
            expect(provider.wordCount).toBe(1);

            adapter.failingWrites.clear();
            await provider.flush();
            expect(savedWords(adapter)).toEqual(["alpha"]);
        });
    });

    describe("saving", () => {
        test("a failed delayed save is logged, the words are saved by the next flush", async () => {
            const { provider, adapter } = await setup();
            provider.addText("alpha", settings);
            adapter.failingWrites.add(WORDS_FILE);
            const error = spyOn(console, "error").mockImplementation(() => {});
            try {
                timers.runAll();
                await flushPromises();
                expect(error).toHaveBeenCalledTimes(1);
            } finally {
                error.mockRestore();
            }
            expect(adapter.files.has(WORDS_FILE)).toBe(false);

            adapter.failingWrites.clear();
            await provider.flush();
            expect(savedWords(adapter)).toEqual(["alpha"]);
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
