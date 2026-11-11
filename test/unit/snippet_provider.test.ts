import { describe, expect, test } from "bun:test";
import type { MathType } from "../../src/editor_context.ts";
import { type CustomEntry, serializeCustomEntries } from "../../src/provider/custom_suggestions.ts";
import type { SuggestionContext } from "../../src/provider/provider.ts";
import { matchSnippetName, SnippetProvider, SNIPPETS_FILE } from "../../src/provider/snippet_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { DEFAULT_CHARACTER_REGEX, isWordChar } from "../../src/text.ts";
import { makeContextAt, makeDataFiles, makeSettings, pluginPath } from "./helpers.ts";

const FILE = pluginPath(SNIPPETS_FILE);

const snip = (displayName: string, replacement = displayName + " text"): CustomEntry => ({ displayName, replacement });

describe("matchSnippetName", () => {
    const letter = (c: string) => isWordChar(c, DEFAULT_CHARACTER_REGEX);
    const match = (before: string, name: string) => matchSnippetName(before, name, letter);

    describe("how much of the name is typed", () => {
        test.each([
            ["m", 1],
            ["me", 2],
            ["meet", 4],
            ["meetin", 6],
            ["meeting", 7],
        ])("%p is a start of 'meeting' of length %p", (before, length) => {
            expect(match(before, "meeting")).toBe(length);
        });

        test("only the text right in front of the cursor counts", () => {
            expect(match("notes for the mee", "meeting")).toBe(3);
            expect(match("mee ", "meeting")).toBe(0);
            expect(match("mee.", "meeting")).toBe(0);
        });

        test("the longest start is found, even if a shorter one ends there too", () => {
            expect(match("abab", "ababc")).toBe(4);
            expect(match("ab ab", "ababc")).toBe(2);
            expect(match("aa", "aaa")).toBe(2);
        });

        test("a name with spaces", () => {
            expect(match("see to do", "to do list")).toBe(5);
            expect(match("see to ", "to do list")).toBe(3);
        });
    });

    describe("no match", () => {
        test("typing past the name", () => {
            expect(match("meetings", "meeting")).toBe(0);
            expect(match("meeting ", "meeting")).toBe(0);
        });

        test("different text", () => {
            expect(match("hello", "meeting")).toBe(0);
            expect(match("eeting", "meeting")).toBe(0);
            expect(match("mest", "meeting")).toBe(0);
        });

        test("is case sensitive, callers lower case both sides", () => {
            expect(match("ME", "meeting")).toBe(0);
            expect(match("me", "Meeting")).toBe(0);
            expect(match("Me", "Meeting")).toBe(2);
        });

        test("nothing typed or an empty name", () => {
            expect(match("", "meeting")).toBe(0);
            expect(match("meeting", "")).toBe(0);
            expect(match("", "")).toBe(0);
        });
    });

    describe("word boundary", () => {
        test("a name starting with a word character matches at the start of the line", () => {
            expect(match("mee", "meeting")).toBe(3);
        });

        test.each([" ", "\t", "(", "-", ".", ">", "1", "_", "😀"])("matches after the non-word character %p", (c) => {
            expect(match("x" + c + "mee", "meeting")).toBe(3);
        });

        test("does not match inside of a word", () => {
            expect(match("homemee", "meeting")).toBe(0);
            expect(match("homemeeting", "meeting")).toBe(0);
            expect(match("ämee", "meeting")).toBe(0);
            expect(match("жmee", "meeting")).toBe(0);
        });

        test("a shorter start at a word boundary still matches", () => {
            // "a-a" is typed, but inside the word "xa". The "a" after the dash starts a word.
            expect(match("xa-a", "a-ab")).toBe(1);
        });

        test("a start inside a word is not rescued by a shorter one", () => {
            expect(match("aaab", "aab")).toBe(0);
            expect(match("meme", "meeting")).toBe(0);
        });

        test("names containing non-word characters match as a whole", () => {
            expect(match("my-n", "my-note")).toBe(4);
            expect(match("see my-", "my-note")).toBe(3);
            expect(match("my-note", "my-note")).toBe(7);
            expect(match("amy-n", "my-note")).toBe(0);
        });

        test("what a word character is comes from the given function", () => {
            const letterOrDigit = (c: string) => /[a-z0-9]/.test(c);
            // "1" is a word character here, so "me" is inside the word "1me"
            expect(matchSnippetName("1me", "meeting", letterOrDigit)).toBe(0);
            expect(match("1me", "meeting")).toBe(2);
            // ... and "1st" starts with a word character, so it needs a boundary
            expect(matchSnippetName("a1", "1st", letterOrDigit)).toBe(0);
            expect(match("a1", "1st")).toBe(1);
        });

        // Guards against reading only the low surrogate of the character in front of the match.
        test("does not match inside of a word that has a letter outside the BMP in front", () => {
            // U+20000, a CJK ideograph: a letter according to the default character class
            expect(letter("𠀀")).toBe(true);
            expect(match("𠀀mee", "meeting")).toBe(0);
        });
    });

    describe("trigger characters", () => {
        test("a name starting with a non-word character matches at the start and after a space", () => {
            expect(match(":s", ":sig")).toBe(2);
            expect(match("text :si", ":sig")).toBe(3);
            expect(match(":sig", ":sig")).toBe(4);
        });

        test("... and also right after a word", () => {
            expect(match("text:s", ":sig")).toBe(2);
            expect(match("a/da", "/date")).toBe(3);
        });

        test("the trigger character alone is a match of length 1", () => {
            expect(match(":", ":sig")).toBe(1);
            expect(match("a:", ":sig")).toBe(1);
        });

        test("without the trigger character there is no match", () => {
            expect(match("si", ":sig")).toBe(0);
            expect(match("; si", ":sig")).toBe(0);
        });

        test("names made of non-word characters only", () => {
            expect(match("a -", "->")).toBe(1);
            expect(match("a->", "->")).toBe(2);
            expect(match("=", "==>")).toBe(1);
            expect(match("==", "==>")).toBe(2);
        });
    });
});

describe("SnippetProvider", () => {
    const MEETING = snip("meeting", "## Meeting {{title}}\nAttendees: {{}}\n\n{{cursor}}");
    const SIG = snip(":sig", "Kind regards,\nTim");
    const NOTE = snip("my-note", "> [!note] {{cursor}}");
    const DATE = snip("/date", "{{2024-01-01}}");
    const SNIPPETS = [MEETING, SIG, NOTE, DATE];

    async function setup(snippets: CustomEntry[] = SNIPPETS) {
        const { files, adapter } = makeDataFiles();
        adapter.files.set(FILE, serializeCustomEntries(snippets));
        const provider = new SnippetProvider(files);
        const error = await provider.load();
        return { provider, adapter, error };
    }

    /** `text` is the cursor's line, `|` marks the cursor. */
    function suggest(
        provider: SnippetProvider,
        text: string,
        overrides: Partial<SuggestionContext> = {},
        settings: Partial<CompletrSettings> = {},
    ) {
        const s = makeSettings(settings);
        return provider.getSuggestions(makeContextAt(text, overrides, s), s);
    }

    const names = (...args: Parameters<typeof suggest>) => suggest(...args).map((s) => s.displayName);

    test("id, icon and the kind of its custom entries", async () => {
        const { provider } = await setup();
        expect(provider.id).toBe("snippet");
        expect(provider.icon).toBe("scissors");
        expect(provider.customEntries.fileName).toBe(SNIPPETS_FILE);
        expect(provider.customEntries.path).toBe(FILE);
        expect(provider.customEntries.kind.noun).toEqual(["snippet", "snippets"]);
        expect(provider.customEntries.kind.nameRequired).toBe(true);
    });

    describe("load", () => {
        test("reads the snippets", async () => {
            const { provider, error } = await setup();
            expect(error).toBeNull();
            expect(provider.customEntries.entries).toEqual(SNIPPETS);
            expect(provider.customEntries.countLabel).toBe("4 snippets");
        });

        test("creates an empty file if it is missing", async () => {
            const { files, adapter } = makeDataFiles();
            const provider = new SnippetProvider(files);
            expect(await provider.load()).toBeNull();
            expect(adapter.files.get(FILE)).toBe("[]");
            expect(provider.customEntries.entries).toEqual([]);
        });

        test("an invalid file returns an error and suggests nothing", async () => {
            const { files, adapter } = makeDataFiles();
            adapter.files.set(FILE, '["meeting"');
            const provider = new SnippetProvider(files);
            expect(await provider.load()).toContain(SNIPPETS_FILE);
            expect(names(provider, "mee|")).toEqual([]);
            expect(names(provider, "|", { manual: true })).toEqual([]);
            expect(adapter.files.get(FILE)).toBe('["meeting"');
        });
    });

    describe("the suggestion", () => {
        test("has the snippet's text, a summary of it and the entry it was made from", async () => {
            const { provider } = await setup();
            expect(suggest(provider, "mee|")).toEqual([
                {
                    displayName: "meeting",
                    replacement: "## Meeting {{title}}\nAttendees: {{}}\n\n{{cursor}}",
                    snippet: "template",
                    overrideStart: { line: 0, ch: 0 },
                    detail: "## Meeting {{title}} …",
                    customEntry: MEETING,
                },
            ]);
        });

        test("customEntry is the provider's own entry object", async () => {
            const { provider } = await setup();
            const [s] = suggest(provider, "mee|");
            expect(s.customEntry).toBe(provider.customEntries.entries[0]);
        });

        test("the detail of a single-line snippet is its whole text", async () => {
            const { provider } = await setup();
            expect(suggest(provider, "my|")[0].detail).toBe("> [!note] {{cursor}}");
            expect(suggest(provider, "/d|")[0].detail).toBe("{{2024-01-01}}");
        });

        test("the replacement is not changed, placeholders are left to the snippet engine", async () => {
            const { provider } = await setup([snip("x", "a {{b}}\n  c {{cursor}}\n")]);
            expect(suggest(provider, "x|")[0].replacement).toBe("a {{b}}\n  c {{cursor}}\n");
        });

        test("suggestions are fresh objects", async () => {
            const { provider } = await setup();
            const [first] = suggest(provider, "mee|");
            first.displayName = "changed";
            first.provider = provider;
            const [second] = suggest(provider, "mee|");
            expect(second.displayName).toBe("meeting");
            expect(second.provider).toBeUndefined();
        });
    });

    describe("overrideStart", () => {
        test("is where the typed start of the name begins", async () => {
            const { provider } = await setup();
            expect(suggest(provider, "m|")[0].overrideStart).toEqual({ line: 0, ch: 0 });
            expect(suggest(provider, "see mee|")[0].overrideStart).toEqual({ line: 0, ch: 4 });
            expect(suggest(provider, "see meeting|")[0].overrideStart).toEqual({ line: 0, ch: 4 });
        });

        test("includes the trigger character, which is not part of the query", async () => {
            const { provider } = await setup();
            const context = makeContextAt("text :si|");
            expect(context.query).toBe("si");
            const [s] = provider.getSuggestions(context, makeSettings());
            expect(s.displayName).toBe(":sig");
            expect(s.overrideStart).toEqual({ line: 0, ch: 5 });
        });

        test("includes everything of a name with non-word characters", async () => {
            const { provider } = await setup();
            const context = makeContextAt("see my-no|");
            expect(context.query).toBe("no");
            const [s] = provider.getSuggestions(context, makeSettings());
            expect(s.displayName).toBe("my-note");
            expect(s.overrideStart).toEqual({ line: 0, ch: 4 });
        });

        test("is on the cursor's line", async () => {
            const { provider } = await setup();
            const [s] = suggest(provider, "  mee|", { end: { line: 7, ch: 5 } });
            expect(s.overrideStart).toEqual({ line: 7, ch: 2 });
        });

        test("text after the cursor does not matter", async () => {
            const { provider } = await setup();
            const result = suggest(provider, "a mee|ting and more");
            expect(result.map((s) => s.displayName)).toEqual(["meeting"]);
            expect(result[0].overrideStart).toEqual({ line: 0, ch: 2 });
            expect(result[0].overrideEnd).toBeUndefined();
        });
    });

    describe("names starting with a word character", () => {
        test("a single typed character is enough", async () => {
            const { provider } = await setup();
            expect(names(provider, "m|")).toEqual(["meeting", "my-note"]);
        });

        test("match at the start of a word", async () => {
            const { provider } = await setup();
            expect(names(provider, "mee|")).toEqual(["meeting"]);
            expect(names(provider, "notes mee|")).toEqual(["meeting"]);
            expect(names(provider, "(mee|")).toEqual(["meeting"]);
            expect(names(provider, "re-mee|")).toEqual(["meeting"]);
        });

        test("do not match inside of a word", async () => {
            const { provider } = await setup();
            expect(names(provider, "homemee|")).toEqual([]);
            expect(names(provider, "homemee|", { manual: true })).toEqual([]);
            expect(names(provider, "amy-n|")).toEqual([]);
        });

        test("match up to the whole name, but not beyond", async () => {
            const { provider } = await setup();
            expect(names(provider, "meeting|")).toEqual(["meeting"]);
            expect(names(provider, "meetings|")).toEqual([]);
            expect(names(provider, "meeting |")).toEqual([]);
        });

        test("names with non-word characters keep matching after them", async () => {
            const { provider } = await setup();
            expect(names(provider, "my|")).toEqual(["my-note"]);
            expect(names(provider, "my-|")).toEqual(["my-note"]);
            expect(names(provider, "my-n|")).toEqual(["my-note"]);
            expect(names(provider, "my-note|")).toEqual(["my-note"]);
            expect(names(provider, "my-x|")).toEqual([]);
        });

        test("the word boundary follows the character class of the settings", async () => {
            const { provider } = await setup();
            expect(names(provider, "1mee|")).toEqual(["meeting"]);
            expect(names(provider, "1mee|", {}, { characterRegex: "a-z0-9" })).toEqual([]);
            expect(names(provider, "ämee|", {}, { characterRegex: "a-z0-9" })).toEqual(["meeting"]);
        });
    });

    describe("names starting with another character", () => {
        test("need two typed characters", async () => {
            const { provider } = await setup();
            expect(names(provider, ":|")).toEqual([]);
            expect(names(provider, "/|")).toEqual([]);
            expect(names(provider, ":s|")).toEqual([":sig"]);
            expect(names(provider, "/d|")).toEqual(["/date"]);
            expect(names(provider, ":sig|")).toEqual([":sig"]);
        });

        test("match everywhere, also right after a word", async () => {
            const { provider } = await setup();
            expect(names(provider, "text :si|")).toEqual([":sig"]);
            expect(names(provider, "text:si|")).toEqual([":sig"]);
            expect(names(provider, "and/or/da|")).toEqual(["/date"]);
        });

        test("do not match without their first character", async () => {
            const { provider } = await setup();
            expect(names(provider, "si|")).toEqual([]);
            expect(names(provider, "date|")).toEqual([]);
        });

        test("one typed character is enough when the popup is opened manually", async () => {
            const { provider } = await setup();
            const result = suggest(provider, "text :|", { manual: true });
            expect(result[0].displayName).toBe(":sig");
            expect(result[0].overrideStart).toEqual({ line: 0, ch: 5 });
        });

        test("a name of a single character only needs that character", async () => {
            const { provider } = await setup([snip("§", "section"), snip("§§", "sections")]);
            expect(names(provider, "§|")).toEqual(["§"]);
            expect(names(provider, "§§|")).toEqual(["§§", "§"]);
        });

        test("which names need a second character follows the character class of the settings", async () => {
            const { provider } = await setup([snip("1st", "first")]);
            expect(names(provider, "1|")).toEqual([]);
            expect(names(provider, "1s|")).toEqual(["1st"]);
            expect(names(provider, "1|", {}, { characterRegex: "a-z0-9" })).toEqual(["1st"]);
        });
    });

    describe("case", () => {
        test("the typed text is matched case-insensitively", async () => {
            const { provider } = await setup();
            expect(names(provider, "MEE|")).toEqual(["meeting"]);
            expect(names(provider, "Meeting|")).toEqual(["meeting"]);
            expect(names(provider, ":SI|")).toEqual([":sig"]);
        });

        test("names are matched case-insensitively and shown as they were written", async () => {
            const { provider } = await setup([snip("Meeting"), snip(":SIG"), snip("ÄRGER")]);
            expect(names(provider, "mee|")).toEqual(["Meeting"]);
            expect(names(provider, "MEE|")).toEqual(["Meeting"]);
            expect(names(provider, ":si|")).toEqual([":SIG"]);
            expect(names(provider, "ärg|")).toEqual(["ÄRGER"]);
        });

        test("overrideStart is right for text that is not lower case", async () => {
            const { provider } = await setup();
            expect(suggest(provider, "ÄÖÜ MEE|")[0].overrideStart).toEqual({ line: 0, ch: 4 });
        });

        test("overrideStart is right if lower casing would change the length of the line", async () => {
            const { provider } = await setup();
            // "İ" is two UTF-16 units in lower case
            expect("İ".toLowerCase()).toHaveLength(2);
            const result = suggest(provider, "İ mee|");
            expect(result.map((s) => s.displayName)).toEqual(["meeting"]);
            expect(result[0].overrideStart).toEqual({ line: 0, ch: 2 });
        });
    });

    describe("manual trigger", () => {
        test("with nothing typed lists all snippets, shortest name first", async () => {
            const { provider } = await setup();
            const result = suggest(provider, "|", { manual: true });
            expect(result.map((s) => s.displayName)).toEqual([":sig", "/date", "meeting", "my-note"]);
            for (const s of result) expect(s.overrideStart).toEqual({ line: 0, ch: 0 });
        });

        test("with no word in front of the cursor lists all snippets and replaces nothing", async () => {
            const { provider } = await setup();
            const result = suggest(provider, "some text. |", { manual: true });
            expect(result).toHaveLength(4);
            for (const s of result) expect(s.overrideStart).toEqual({ line: 0, ch: 11 });
        });

        test("a snippet whose name is partly typed comes first and replaces what is typed", async () => {
            const { provider } = await setup();
            const result = suggest(provider, "a /|", { manual: true });
            expect(result.map((s) => [s.displayName, s.overrideStart?.ch])).toEqual([
                ["/date", 2],
                [":sig", 3],
                ["meeting", 3],
                ["my-note", 3],
            ]);
        });

        test("with a word in front of the cursor only matching snippets are listed", async () => {
            const { provider } = await setup();
            expect(names(provider, "mee|", { manual: true })).toEqual(["meeting"]);
            expect(names(provider, "xyz|", { manual: true })).toEqual([]);
        });

        test("nothing is listed without a manual trigger and nothing typed", async () => {
            const { provider } = await setup();
            expect(names(provider, "|")).toEqual([]);
            expect(names(provider, "some text. |")).toEqual([]);
        });
    });

    describe("order", () => {
        test("the longest match first", async () => {
            // Both are typed completely, ":sig" with one more character
            const { provider } = await setup([snip("sig"), snip(":sig")]);
            const result = suggest(provider, ":sig|");
            expect(result.map((s) => [s.displayName, s.overrideStart?.ch])).toEqual([
                [":sig", 0],
                ["sig", 1],
            ]);
        });

        test("then the shortest name", async () => {
            const { provider } = await setup([snip("meeting"), snip("meet-up"), snip("me"), snip("memo")]);
            expect(names(provider, "me|")).toEqual(["me", "memo", "meeting", "meet-up"]);
            expect(names(provider, "mee|")).toEqual(["meeting", "meet-up"]);
        });

        test("snippets with the same name are all suggested, in file order", async () => {
            const { provider } = await setup([snip("todo", "first"), snip("todo", "second")]);
            expect(suggest(provider, "to|").map((s) => s.replacement)).toEqual(["first", "second"]);
        });
    });

    describe("math", () => {
        test.each(["inline", "block"] as const)("nothing inside %s math", async (type) => {
            const { provider } = await setup();
            expect(names(provider, "$mee|", { mathType: () => type })).toEqual([]);
            expect(names(provider, "$:si|", { mathType: () => type })).toEqual([]);
            expect(names(provider, "$|", { mathType: () => type, manual: true })).toEqual([]);
        });

        test("a dollar sign inside code is not math for snippets", async () => {
            const { provider } = await setup();
            const asked: boolean[] = [];
            const mathType = (triggerInCode: boolean): MathType | null => {
                asked.push(triggerInCode);
                return triggerInCode ? "inline" : null;
            };
            expect(names(provider, "`$mee|", { mathType, inCode: true })).toEqual(["meeting"]);
            expect(asked).toEqual([false]);
        });

        test("the context is only asked if a snippet matches", async () => {
            const { provider } = await setup();
            let asked = 0;
            const mathType = () => {
                asked++;
                return null;
            };
            expect(names(provider, "xyz|", { mathType })).toEqual([]);
            expect(asked).toBe(0);
            expect(names(provider, "mee|", { mathType })).toEqual(["meeting"]);
            expect(asked).toBe(1);
        });
    });

    describe("settings", () => {
        test("disabled snippets", async () => {
            const { provider } = await setup();
            expect(names(provider, "mee|", {}, { snippetsEnabled: false })).toEqual([]);
            expect(names(provider, "|", { manual: true }, { snippetsEnabled: false })).toEqual([]);
        });

        test("the minimum word lengths of the word providers do not apply", async () => {
            const { provider } = await setup();
            const settings = { minWordTriggerLength: 5, minWordLength: 10 };
            expect(names(provider, "m|", {}, settings)).toEqual(["meeting", "my-note"]);
        });

        test("snippets are suggested inside code", async () => {
            const { provider } = await setup();
            expect(names(provider, "`mee|", { inCode: true }, { disableWordsInCode: true })).toEqual(["meeting"]);
        });
    });

    describe("changes to the snippets", () => {
        test("no snippets means no suggestions, without asking the context", async () => {
            const { provider } = await setup([]);
            const mathType = () => {
                throw new Error("must not be called");
            };
            expect(names(provider, "mee|", { mathType })).toEqual([]);
            expect(names(provider, "|", { mathType, manual: true })).toEqual([]);
        });

        test("nothing is suggested before loading", () => {
            const { files, adapter } = makeDataFiles();
            adapter.files.set(FILE, serializeCustomEntries(SNIPPETS));
            expect(names(new SnippetProvider(files), "mee|")).toEqual([]);
        });

        test("added, replaced and removed snippets are used right away", async () => {
            const { provider, adapter } = await setup([]);
            await provider.customEntries.add(snip("todo", "- [ ] {{cursor}}"));
            expect(suggest(provider, "to|").map((s) => s.replacement)).toEqual(["- [ ] {{cursor}}"]);
            expect(JSON.parse(adapter.files.get(FILE)!)).toEqual([
                { displayName: "todo", replacement: "- [ ] {{cursor}}" },
            ]);

            await provider.customEntries.replace(provider.customEntries.entries[0], snip("task", "- [ ] "));
            expect(names(provider, "to|")).toEqual([]);
            expect(names(provider, "ta|")).toEqual(["task"]);

            await provider.customEntries.remove(provider.customEntries.entries[0]);
            expect(names(provider, "ta|")).toEqual([]);
        });

        test("reloading picks up changes of the file", async () => {
            const { provider, adapter } = await setup();
            adapter.files.set(FILE, serializeCustomEntries([snip("other")]));
            await provider.load();
            expect(names(provider, "|", { manual: true })).toEqual(["other"]);
        });
    });

    // Guards against an empty name "matching" at every cursor position (snippets.json can be edited by hand).
    test("a snippet with an empty name is not suggested while typing", async () => {
        const { provider } = await setup([snip("", "text")]);
        expect(names(provider, "hello|")).toEqual([]);
        expect(names(provider, "hello |")).toEqual([]);
    });
});
