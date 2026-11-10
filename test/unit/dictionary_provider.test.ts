import { describe, expect, test } from "bun:test";
import { DictionaryProvider, sortWords } from "../../src/provider/dictionary_provider.ts";
import type { SuggestionContext } from "../../src/provider/provider.ts";
import { type CompletrSettings, SortOrder, WordInsertionMode } from "../../src/settings.ts";
import { WordIndex, type WordMatch } from "../../src/word_index.ts";
import { makeContext, makeSettings } from "./helpers.ts";

class TestProvider extends DictionaryProvider {
    readonly id = "test";
    readonly icon = "test";
    enabled = true;
    readonly index = new WordIndex();
    /** The settings getIndex was called with. */
    readonly indexRequests: CompletrSettings[] = [];

    constructor(words: string[]) {
        super();
        this.index.setAll(words);
    }

    protected isEnabled(): boolean {
        return this.enabled;
    }

    protected getIndex(settings: CompletrSettings): WordIndex {
        this.indexRequests.push(settings);
        return this.index;
    }
}

function suggest(
    words: string[],
    query: string,
    settings: Partial<CompletrSettings> = {},
    context: Partial<SuggestionContext> = {},
) {
    return new TestProvider(words).getSuggestions(makeContext(query, context), makeSettings(settings));
}

const names = (...args: Parameters<typeof suggest>) => suggest(...args).map((s) => s.displayName);

const match = (word: string): WordMatch => ({ word, isPrefixMatch: true, score: 0, matches: [] });
const sorted = (words: string[], order: SortOrder, locale = "en") =>
    sortWords(words.map(match), order, locale).map((m) => m.word);

describe("sortWords", () => {
    test("shortest first, stable for equal lengths", () => {
        expect(sorted(["ccc", "a", "bb", "b", "aaa"], SortOrder.SHORTEST_FIRST)).toEqual([
            "a",
            "b",
            "bb",
            "ccc",
            "aaa",
        ]);
    });

    test("longest first, stable for equal lengths", () => {
        expect(sorted(["ccc", "a", "bb", "b", "aaa"], SortOrder.LONGEST_FIRST)).toEqual(["ccc", "aaa", "bb", "a", "b"]);
    });

    test("alphabetical ignores case and accents", () => {
        expect(sorted(["b", "C", "a", "B"], SortOrder.ALPHABETICAL)).toEqual(["a", "b", "B", "C"]);
        expect(sorted(["eb", "éa", "ec"], SortOrder.ALPHABETICAL)).toEqual(["éa", "eb", "ec"]);
    });

    test("alphabetical sorts numbers numerically", () => {
        expect(sorted(["item10", "item2", "item1"], SortOrder.ALPHABETICAL)).toEqual(["item1", "item2", "item10"]);
    });

    test("alphabetical respects the locale: German sorts umlauts like their base letter", () => {
        expect(sorted(["zebra", "äpfel", "apfel", "birne"], SortOrder.ALPHABETICAL, "de")).toEqual([
            "äpfel",
            "apfel",
            "birne",
            "zebra",
        ]);
    });

    test("alphabetical respects the locale: Swedish sorts å, ä, ö after z", () => {
        expect(sorted(["ö", "z", "å", "a", "ä"], SortOrder.ALPHABETICAL, "sv")).toEqual(["a", "z", "å", "ä", "ö"]);
    });

    test("an empty locale uses the default locale", () => {
        expect(sorted(["b", "a"], SortOrder.ALPHABETICAL, "")).toEqual(["a", "b"]);
    });

    test("an invalid locale falls back to the default instead of throwing", () => {
        expect(sorted(["b", "a"], SortOrder.ALPHABETICAL, "not a locale!")).toEqual(["a", "b"]);
    });

    test("unknown sort orders fall back to shortest first", () => {
        expect(sorted(["aaa", "a"], "bogus" as SortOrder)).toEqual(["a", "aaa"]);
    });

    test("sorts in place and returns the array", () => {
        const arr = ["bb", "a"].map(match);
        expect(sortWords(arr, SortOrder.SHORTEST_FIRST, "")).toBe(arr);
    });
});

describe("DictionaryProvider", () => {
    const words = ["hello", "help", "helicopter", "Hello", "world", "he"];

    test("returns prefix matches as suggestions", () => {
        expect(suggest(words, "hel")).toEqual([
            { displayName: "help", replacement: "help", matches: [[0, 3]], isFuzzy: false, appendSpace: false },
            { displayName: "hello", replacement: "hello", matches: [[0, 3]], isFuzzy: false, appendSpace: false },
            { displayName: "Hello", replacement: "Hello", matches: [[0, 3]], isFuzzy: false, appendSpace: false },
            {
                displayName: "helicopter",
                replacement: "helicopter",
                matches: [[0, 3]],
                isFuzzy: false,
                appendSpace: false,
            },
        ]);
    });

    test("disabled provider returns nothing", () => {
        const provider = new TestProvider(words);
        provider.enabled = false;
        expect(provider.getSuggestions(makeContext("hel"), makeSettings())).toEqual([]);
        expect(provider.indexRequests).toEqual([]);
    });

    test("the settings are passed to getIndex", () => {
        const provider = new TestProvider(words);
        const settings = makeSettings({ fileScannerCurrentFileOnly: true });
        provider.getSuggestions(makeContext("hel"), settings);
        expect(provider.indexRequests).toHaveLength(1);
        expect(provider.indexRequests[0]).toBe(settings);
    });

    test("no index is asked for if the query is too short", () => {
        const provider = new TestProvider(words);
        provider.getSuggestions(makeContext("he"), makeSettings({ minWordTriggerLength: 3 }));
        provider.getSuggestions(makeContext(""), makeSettings());
        expect(provider.indexRequests).toEqual([]);
    });

    test("the math type is only looked at for a word after a backslash", () => {
        const provider = new TestProvider(words);
        for (const separatorChar of [null, " ", "{", "$"]) {
            const context = makeContext("hel", {
                separatorChar,
                mathType: () => {
                    throw new Error("must not be called");
                },
            });
            expect(provider.getSuggestions(context, makeSettings())).toHaveLength(4);
        }
    });

    describe("after a backslash", () => {
        const inMath = { separatorChar: "\\", mathType: () => "inline" as const };

        test("in math nothing is suggested: the word is the name of a command", () => {
            const provider = new TestProvider(words);
            expect(provider.getSuggestions(makeContext("hel", inMath), makeSettings())).toEqual([]);
            expect(provider.getSuggestions(makeContext("hel", { ...inMath, manual: true }), makeSettings())).toEqual(
                [],
            );
            expect(
                provider.getSuggestions(
                    makeContext("hel", { separatorChar: "\\", mathType: () => "block" }),
                    makeSettings(),
                ),
            ).toEqual([]);
            // Not even searched
            expect(provider.indexRequests).toEqual([]);
        });

        test("in math, words are still suggested after other characters", () => {
            for (const separatorChar of [null, " ", "{", "_", "$"])
                expect(names(words, "hel", {}, { ...inMath, separatorChar })).toEqual([
                    "help",
                    "hello",
                    "Hello",
                    "helicopter",
                ]);
        });

        test("outside of math, words are suggested", () => {
            expect(names(words, "hel", {}, { separatorChar: "\\", mathType: () => null })).toEqual([
                "help",
                "hello",
                "Hello",
                "helicopter",
            ]);
        });

        test("whether a dollar sign in code starts math follows latexTriggerInCodeBlocks", () => {
            for (const latexTriggerInCodeBlocks of [true, false]) {
                const calls: boolean[] = [];
                const context = makeContext("hel", {
                    separatorChar: "\\",
                    mathType: (triggerInCode) => {
                        calls.push(triggerInCode);
                        return triggerInCode ? "inline" : null;
                    },
                });
                const result = new TestProvider(words).getSuggestions(
                    context,
                    makeSettings({ latexTriggerInCodeBlocks }),
                );
                expect(calls).toEqual([latexTriggerInCodeBlocks]);
                expect(result).toHaveLength(latexTriggerInCodeBlocks ? 0 : 4);
            }
        });
    });

    test("suggestions are plain words: no snippet, detail, preview or custom entry", () => {
        for (const s of suggest(words, "hel", { fuzzyMatching: true })) {
            expect(Object.keys(s).sort()).toEqual(["appendSpace", "displayName", "isFuzzy", "matches", "replacement"]);
        }
    });

    describe("trigger length", () => {
        test("queries shorter than minWordTriggerLength are ignored", () => {
            expect(names(words, "he", { minWordTriggerLength: 3 })).toEqual([]);
            expect(names(words, "hel", { minWordTriggerLength: 3 })).not.toEqual([]);
            expect(names(words, "he", { minWordTriggerLength: 2 })).not.toEqual([]);
        });

        test("an empty query never triggers automatically", () => {
            expect(names(words, "", { minWordTriggerLength: 0 })).toEqual([]);
        });

        test("manual trigger ignores the minimum length", () => {
            expect(names(words, "h", { minWordTriggerLength: 3 }, { manual: true })).toEqual([
                "he",
                "help",
                "hello",
                "Hello",
                "helicopter",
            ]);
        });

        test("manual trigger with an empty query lists all words", () => {
            expect(names(words, "", {}, { manual: true }).sort()).toEqual([...words].sort());
        });
    });

    test("words shorter than minWordLength are filtered", () => {
        expect(names(["ab", "abc", "abcd"], "a", { minWordLength: 3 }, { manual: true })).toEqual(["abc", "abcd"]);
        expect(names(["ab", "abc", "abcd"], "a", { minWordLength: 0 }, { manual: true })).toEqual([
            "ab",
            "abc",
            "abcd",
        ]);
    });

    test("minWordLength is applied per query, so changing it needs no reload of the words", () => {
        const provider = new TestProvider(["ab", "abc", "abcd"]);
        const query = (minWordLength: number) =>
            provider
                .getSuggestions(makeContext("a", { manual: true }), makeSettings({ minWordLength }))
                .map((s) => s.displayName);
        expect(query(4)).toEqual(["abcd"]);
        expect(query(2)).toEqual(["ab", "abc", "abcd"]);
        expect(query(3)).toEqual(["abc", "abcd"]);
        expect(provider.index.size).toBe(3);
    });

    test("the exact typed word is not suggested", () => {
        expect(names(words, "help")).toEqual([]);
        expect(names(["hello", "hellooo"], "hello")).toEqual(["hellooo"]);
    });

    test("a word differing only in case from the query is suggested (it changes the casing)", () => {
        expect(names(["Hello"], "hello")).toEqual(["Hello"]);
    });

    describe("insertion modes", () => {
        test("Ignore-Case & Replace inserts the word as is", () => {
            const result = suggest(words, "HEL", { wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE });
            expect(result.map((s) => s.replacement)).toEqual(["help", "hello", "Hello", "helicopter"]);
        });

        test("Match-Case & Replace only matches words with the same case", () => {
            const mode = { wordInsertionMode: WordInsertionMode.MATCH_CASE_REPLACE };
            expect(names(words, "Hel", mode)).toEqual(["Hello"]);
            expect(names(words, "hel", mode)).toEqual(["help", "hello", "helicopter"]);
            expect(names(words, "HEL", mode)).toEqual([]);
        });

        test("Ignore-Case & Append keeps the typed casing", () => {
            const mode = { wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND };
            const result = suggest(["hello", "helicopter"], "HEL", mode);
            expect(result.map((s) => [s.displayName, s.replacement])).toEqual([
                ["HELlo", "HELlo"],
                ["HELicopter", "HELicopter"],
            ]);
            expect(names(["hello"], "Hel", mode)).toEqual(["Hello"]);
        });

        test("Ignore-Case & Append keeps the word's diacritics (#98)", () => {
            const mode = {
                wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND,
                ignoreDiacriticsWhenFiltering: true,
            };
            expect(names(["āṣīṛū"], "asi", mode)).toEqual(["āṣīṛū"]);
            expect(names(["āṣīṛū"], "Asi", mode)).toEqual(["Āṣīṛū"]);
        });

        test("Ignore-Case & Append does not change fuzzy matches", () => {
            const mode = { wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND, fuzzyMatching: true };
            expect(names(["markdown"], "MKD", mode)).toEqual(["markdown"]);
        });

        test("Ignore-Case & Append does not suggest exactly what was typed", () => {
            const mode = { wordInsertionMode: WordInsertionMode.IGNORE_CASE_APPEND };
            expect(names(["Hello", "hellos"], "hello", mode)).toEqual(["hellos"]);
        });
    });

    describe("sort order", () => {
        const sortWordsList = ["abcd", "ab", "Abc", "abcde", "äbc"];

        test("shortest first", () => {
            expect(names(sortWordsList, "ab", { sortOrder: SortOrder.SHORTEST_FIRST }, { manual: true })).toEqual([
                "Abc",
                "abcd",
                "abcde",
            ]);
        });

        test("longest first", () => {
            expect(names(sortWordsList, "ab", { sortOrder: SortOrder.LONGEST_FIRST }, { manual: true })).toEqual([
                "abcde",
                "abcd",
                "Abc",
            ]);
        });

        test("alphabetical with locale", () => {
            const settings = {
                sortOrder: SortOrder.ALPHABETICAL,
                sortLocale: "de",
                ignoreDiacriticsWhenFiltering: true,
            };
            expect(names(["abd", "äbc", "abe", "Abb"], "ab", settings, { manual: true })).toEqual([
                "Abb",
                "äbc",
                "abd",
                "abe",
            ]);
            expect(
                names(["abd", "äbc", "abe", "Abb"], "ab", { ...settings, sortLocale: "sv" }, { manual: true }),
            ).toEqual(["Abb", "abd", "abe", "äbc"]);
        });
    });

    describe("fuzzy matching", () => {
        test("fuzzy matches come after all prefix matches, regardless of sort order", () => {
            const fuzzyWords = ["mkdocs_extra_long_word", "markdown", "mkd", "mkdir"];
            const result = suggest(fuzzyWords, "mkd", { fuzzyMatching: true, sortOrder: SortOrder.LONGEST_FIRST });
            expect(result.map((s) => [s.displayName, s.isFuzzy])).toEqual([
                ["mkdocs_extra_long_word", false],
                ["mkdir", false],
                ["markdown", true],
            ]);
            expect(result[2].matches).toEqual([
                [0, 1],
                [3, 5],
            ]);
        });

        test("fuzzy matches keep their score order instead of the sort order", () => {
            const result = names(["axbxc", "abxc", "abxxxxxxc"], "abc", {
                fuzzyMatching: true,
                sortOrder: SortOrder.SHORTEST_FIRST,
            });
            expect(result).toEqual(["abxc", "abxxxxxxc", "axbxc"]);
        });

        test("fuzzy matches are filtered by minWordLength too", () => {
            expect(names(["mxkd", "mkdxxx"], "mkd", { fuzzyMatching: true, minWordLength: 5 })).toEqual(["mkdxxx"]);
        });

        test("disabled fuzzy matching", () => {
            expect(names(["markdown"], "mkd", { fuzzyMatching: false })).toEqual([]);
        });
    });

    describe("diacritics", () => {
        test("ignoreDiacriticsWhenFiltering finds words with diacritics", () => {
            expect(names(["café", "cafeteria"], "cafe", { ignoreDiacriticsWhenFiltering: true })).toEqual([
                "café",
                "cafeteria",
            ]);
            expect(names(["café", "cafeteria"], "cafe", { ignoreDiacriticsWhenFiltering: false })).toEqual([
                "cafeteria",
            ]);
        });
    });

    describe("code blocks", () => {
        test("disableWordsInCode hides suggestions in code", () => {
            expect(names(words, "hel", { disableWordsInCode: true }, { inCode: true })).toEqual([]);
            expect(names(words, "hel", { disableWordsInCode: true }, { inCode: true, manual: true })).toEqual([]);
        });

        test("words are suggested in code if the setting is off", () => {
            expect(names(words, "hel", { disableWordsInCode: false }, { inCode: true })).toHaveLength(4);
        });

        test("disableWordsInCode does not affect normal text", () => {
            expect(names(words, "hel", { disableWordsInCode: true }, { inCode: false })).toHaveLength(4);
        });
    });

    test("appendSpace follows insertSpaceAfterWord", () => {
        expect(suggest(["hello"], "hel", { insertSpaceAfterWord: true })[0].appendSpace).toBe(true);
        expect(suggest(["hello"], "hel", { insertSpaceAfterWord: false })[0].appendSpace).toBe(false);
    });

    test("prefix suggestions are capped at 200", () => {
        const many = Array.from({ length: 500 }, (_, i) => "word" + i);
        expect(names(many, "wor")).toHaveLength(200);
        // The cap applies after sorting: the shortest words survive
        expect(names(many, "wor").slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => "word" + i));
    });

    test("fuzzy suggestions are capped at 200 as well", () => {
        const many = Array.from({ length: 300 }, (_, i) => "ax" + i + "b");
        expect(names(many, "ab", { fuzzyMatching: true }, { manual: true })).toHaveLength(200);
    });
});
