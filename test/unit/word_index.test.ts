import { describe, expect, test } from "bun:test";
import { fuzzyMatch, type SearchOptions, WordIndex } from "../../src/word_index.ts";

const opts = { ignoreCase: true, ignoreDiacritics: false, fuzzy: false };
const caseSensitive = { ignoreCase: false, ignoreDiacritics: false, fuzzy: false };
const noDiacritics = { ignoreCase: true, ignoreDiacritics: true, fuzzy: false };
const fuzzy = { ignoreCase: true, ignoreDiacritics: false, fuzzy: true };

function indexOf(...words: string[]): WordIndex {
    const index = new WordIndex();
    index.setAll(words);
    return index;
}

const words = (index: WordIndex, query: string, options: SearchOptions = opts) =>
    index.search(query, options).map((m) => m.word);

describe("WordIndex", () => {
    test("finds words by prefix", () => {
        const index = new WordIndex();
        index.setAll(["hello", "help", "world", "Hero"]);
        expect(index.search("he", opts).map((m) => m.word)).toEqual(["hello", "help", "Hero"]);
    });

    test("keeps views up to date when adding words after a search", () => {
        const index = new WordIndex();
        index.setAll(["alpha"]);
        expect(index.search("a", opts).map((m) => m.word)).toEqual(["alpha"]);
        index.add("apple");
        expect(index.search("a", opts).map((m) => m.word)).toEqual(["alpha", "apple"]);
    });

    test("prefix matches are marked and highlighted", () => {
        expect(indexOf("hello").search("hel", opts)).toEqual([
            { word: "hello", isPrefixMatch: true, score: 0, matches: [[0, 3]] },
        ]);
    });

    test("a word equal to the query is a prefix match", () => {
        expect(words(indexOf("hello", "hell"), "hell")).toEqual(["hell", "hello"]);
    });

    test("no matches", () => {
        expect(words(indexOf("hello", "world"), "x")).toEqual([]);
        expect(words(new WordIndex(), "x")).toEqual([]);
    });

    test("query longer than the words", () => {
        expect(words(indexOf("he"), "hello")).toEqual([]);
    });

    test("empty query returns all words, without highlights", () => {
        const index = indexOf("b", "a", "C");
        const result = index.search("", opts);
        expect(result.map((m) => m.word)).toEqual(["a", "b", "C"]);
        for (const m of result) expect(m.matches).toEqual([]);
        expect(words(index, "", caseSensitive)).toEqual(["C", "a", "b"]);
        expect(words(index, "", fuzzy)).toEqual(["a", "b", "C"]);
    });

    describe("case handling", () => {
        const index = indexOf("Hello", "hello", "HELP", "world");

        test("ignoreCase matches regardless of the case of query and word", () => {
            expect(words(index, "HEL").sort()).toEqual(["HELP", "Hello", "hello"]);
            expect(words(index, "hel").sort()).toEqual(["HELP", "Hello", "hello"]);
        });

        test("case sensitive search", () => {
            expect(words(index, "Hel", caseSensitive)).toEqual(["Hello"]);
            expect(words(index, "hel", caseSensitive)).toEqual(["hello"]);
            expect(words(index, "HEL", caseSensitive)).toEqual(["HELP"]);
        });

        test("non ASCII letters", () => {
            const i = indexOf("Äpfel", "äther", "Ωmega");
            expect(words(i, "ä").sort()).toEqual(["Äpfel", "äther"]);
            expect(words(i, "ωm")).toEqual(["Ωmega"]);
            expect(words(i, "ä", caseSensitive)).toEqual(["äther"]);
        });
    });

    describe("diacritics handling", () => {
        const index = indexOf("hèllo", "hello", "Ĥat", "naïve");

        test("ignoreDiacritics matches words with diacritics", () => {
            expect(words(index, "hel", noDiacritics).sort()).toEqual(["hello", "hèllo"]);
            expect(words(index, "nai", noDiacritics)).toEqual(["naïve"]);
            expect(words(index, "hat", noDiacritics)).toEqual(["Ĥat"]);
        });

        test("the query's diacritics are ignored as well", () => {
            expect(words(index, "hèl", noDiacritics).sort()).toEqual(["hello", "hèllo"]);
        });

        test("without ignoreDiacritics they must match exactly", () => {
            expect(words(index, "hel")).toEqual(["hello"]);
            expect(words(index, "hèl")).toEqual(["hèllo"]);
        });

        test("Devanagari words are not mangled by diacritics removal", () => {
            const i = indexOf("किताब", "कितना", "कमल");
            expect(words(i, "कित", noDiacritics).sort()).toEqual(["कितना", "किताब"]);
            expect(words(i, "कि", noDiacritics)).not.toContain("कमल");
        });
    });

    describe("views", () => {
        test("views for different options are independent", () => {
            const index = indexOf("Hello", "hèllo");
            expect(words(index, "he")).toEqual(["Hello"]);
            expect(words(index, "He", caseSensitive)).toEqual(["Hello"]);
            expect(words(index, "he", noDiacritics).sort()).toEqual(["Hello", "hèllo"]);
        });

        test("added words are inserted in every existing view", () => {
            const index = indexOf("beta", "Delta");
            words(index, "", opts);
            words(index, "", caseSensitive);
            words(index, "", noDiacritics);

            expect(index.add("alpha")).toBe(true);
            expect(index.add("Ćharlie")).toBe(true);
            expect(index.add("gamma")).toBe(true);

            expect(words(index, "", opts)).toEqual(["alpha", "beta", "Delta", "gamma", "Ćharlie"]);
            expect(words(index, "", caseSensitive)).toEqual(["Delta", "alpha", "beta", "gamma", "Ćharlie"]);
            expect(words(index, "", noDiacritics)).toEqual(["alpha", "beta", "Ćharlie", "Delta", "gamma"]);
            expect(words(index, "ch", noDiacritics)).toEqual(["Ćharlie"]);
        });

        test("deleted words are removed from every existing view", () => {
            const index = indexOf("alpha", "Alpine", "beta");
            words(index, "", opts);
            words(index, "", caseSensitive);

            expect(index.delete("Alpine")).toBe(true);
            expect(words(index, "al")).toEqual(["alpha"]);
            expect(words(index, "Al", caseSensitive)).toEqual([]);
            expect(words(index, "", caseSensitive)).toEqual(["alpha", "beta"]);
        });

        test("adding and deleting before any view exists", () => {
            const index = new WordIndex();
            index.add("b");
            index.add("a");
            index.delete("b");
            expect(words(index, "")).toEqual(["a"]);
        });

        test("views built after incremental changes are correct", () => {
            const index = indexOf("x");
            words(index, "");
            index.add("y");
            index.delete("x");
            expect(words(index, "", caseSensitive)).toEqual(["y"]);
            expect(words(index, "")).toEqual(["y"]);
        });

        test("many incremental additions keep the view sorted", () => {
            const index = new WordIndex();
            words(index, "");
            const all = Array.from({ length: 200 }, (_, i) => "w" + ((i * 37) % 200).toString().padStart(3, "0"));
            for (const w of all) index.add(w);
            expect(words(index, "")).toEqual([...all].sort());
        });

        test("prepare builds a view that is then kept up to date", () => {
            const index = indexOf("beta");
            index.prepare(opts);
            index.add("Alpha");
            index.delete("beta");
            expect(words(index, "")).toEqual(["Alpha"]);
        });

        test("prepare with search options only uses the normalization part", () => {
            const index = indexOf("Hello");
            index.prepare({ ...fuzzy, fuzzyLimit: 1 } as SearchOptions);
            expect(words(index, "he")).toEqual(["Hello"]);
        });

        test("case variants of the same word are all found and individually deletable", () => {
            const index = indexOf("hello", "Hello", "HELLO", "help", "hel");
            expect(words(index, "hel")).toEqual(["hel", "hello", "HELLO", "Hello", "help"]);
            index.delete("Hello");
            expect(words(index, "hel")).toEqual(["hel", "hello", "HELLO", "help"]);
            index.delete("hello");
            expect(words(index, "hello")).toEqual(["HELLO"]);
            index.add("hEllo");
            expect(words(index, "hello")).toEqual(["HELLO", "hEllo"]);
        });

        test("a word whose key is a prefix of another key", () => {
            const index = indexOf("Ab", "abc", "AB", "ab");
            expect(words(index, "ab")).toEqual(["ab", "AB", "Ab", "abc"]);
            expect(words(index, "abc")).toEqual(["abc"]);
        });

        test("diacritics variants are individually deletable", () => {
            const index = indexOf("café", "cafe", "Café");
            words(index, "", noDiacritics);
            index.delete("café");
            expect(words(index, "caf", noDiacritics)).toEqual(["cafe", "Café"]);
        });
    });

    describe("add / delete / setAll / clear", () => {
        test("add returns whether the word is new", () => {
            const index = new WordIndex();
            expect(index.add("a")).toBe(true);
            expect(index.add("a")).toBe(false);
            expect(index.add("A")).toBe(true);
            expect(index.size).toBe(2);
        });

        test("empty words are never added", () => {
            const index = new WordIndex();
            expect(index.add("")).toBe(false);
            index.setAll(["", "a", ""]);
            expect(index.size).toBe(1);
            expect(index.has("")).toBe(false);
        });

        test("adding a duplicate does not duplicate it in views", () => {
            const index = indexOf("a");
            words(index, "");
            index.add("a");
            expect(words(index, "")).toEqual(["a"]);
        });

        test("delete returns whether the word was known", () => {
            const index = indexOf("a");
            expect(index.delete("b")).toBe(false);
            expect(index.delete("a")).toBe(true);
            expect(index.delete("a")).toBe(false);
            expect(index.size).toBe(0);
        });

        test("delete of an unknown word does not touch views", () => {
            const index = indexOf("Hello", "hello");
            words(index, "");
            index.delete("HELLO");
            expect(words(index, "").sort()).toEqual(["Hello", "hello"]);
        });

        test("setAll replaces all words and rebuilds views", () => {
            const index = indexOf("old", "older");
            expect(words(index, "o")).toEqual(["old", "older"]);
            index.setAll(["new", "newer", "new"]);
            expect(index.size).toBe(2);
            expect(words(index, "o")).toEqual([]);
            expect(words(index, "n")).toEqual(["new", "newer"]);
        });

        test("clear removes everything", () => {
            const index = indexOf("a", "b");
            words(index, "");
            index.clear();
            expect(index.size).toBe(0);
            expect(words(index, "")).toEqual([]);
            index.add("c");
            expect(words(index, "")).toEqual(["c"]);
        });

        test("has / values", () => {
            const index = indexOf("a", "b");
            expect(index.has("a")).toBe(true);
            expect(index.has("A")).toBe(false);
            expect([...index.values()].sort()).toEqual(["a", "b"]);
        });
    });

    describe("addAll", () => {
        const allOptions: SearchOptions[] = [
            opts,
            caseSensitive,
            noDiacritics,
            fuzzy,
            { ignoreCase: false, ignoreDiacritics: true, fuzzy: true },
        ];
        const queries = ["", "a", "al", "AL", "äl", "alx", "be", "bé", "c", "ca", "çax1", "ax", "bx2", "zz"];

        /** Distinct pseudo words in a shuffled order, with mixed case and diacritics. */
        function makeWords(count: number, tag: string): string[] {
            const starts = ["al", "Al", "äl", "AL", "be", "Bé", "ca", "ça", "Ĉa", "de"];
            // 7919 is prime, so this visits every number below `count` exactly once
            return Array.from(
                { length: count },
                (_, i) => starts[i % starts.length] + tag + ((i * 7919) % count).toString(36),
            );
        }

        const searchAll = (index: WordIndex) =>
            allOptions.map((options) => queries.map((query) => index.search(query, options)));

        test("returns the number of new words", () => {
            const index = indexOf("a", "b");
            expect(index.addAll(["b", "c", "d"])).toBe(2);
            expect(index.size).toBe(4);
            expect(index.addAll(["a", "b", "c", "d"])).toBe(0);
            expect(index.addAll([])).toBe(0);
            expect(index.size).toBe(4);
        });

        test("duplicates within the batch are added once", () => {
            const index = new WordIndex();
            expect(index.addAll(["x", "y", "x", "X", "y"])).toBe(3);
            expect(words(index, "")).toEqual(["x", "X", "y"]);
        });

        test("empty strings are skipped", () => {
            const index = new WordIndex();
            expect(index.addAll(["", "a", ""])).toBe(1);
            expect(index.addAll([""])).toBe(0);
            expect(index.has("")).toBe(false);
            expect(index.size).toBe(1);
        });

        test("accepts any iterable", () => {
            const index = new WordIndex();
            expect(index.addAll(new Set(["a", "b"]))).toBe(2);
            expect(index.addAll(indexOf("b", "c").values())).toBe(1);
            expect(words(index, "")).toEqual(["a", "b", "c"]);
        });

        test("works before any view exists", () => {
            const index = new WordIndex();
            index.addAll(["beta", "Alpha"]);
            expect(words(index, "")).toEqual(["Alpha", "beta"]);
        });

        test("new words are inserted in every existing view", () => {
            const index = indexOf("beta", "Delta");
            for (const options of [opts, caseSensitive, noDiacritics]) words(index, "", options);

            expect(index.addAll(["alpha", "Ćharlie", "gamma", "beta"])).toBe(3);
            expect(words(index, "", opts)).toEqual(["alpha", "beta", "Delta", "gamma", "Ćharlie"]);
            expect(words(index, "", caseSensitive)).toEqual(["Delta", "alpha", "beta", "gamma", "Ćharlie"]);
            expect(words(index, "", noDiacritics)).toEqual(["alpha", "beta", "Ćharlie", "Delta", "gamma"]);
        });

        // Up to 256 new words are inserted into the views, more than that drops them
        test.each([1, 50, 255, 256, 257, 258, 1000])(
            "adding %p words to built views finds the same as adding them one by one",
            (count) => {
                const existing = makeWords(40, "x");
                const fresh = makeWords(count, "y");
                // Known words, empty strings and repeated words don't count
                const batch = [...fresh, "", ...existing.slice(0, 5), ...fresh.slice(0, 3)];

                const oneByOne = indexOf(...existing);
                const atOnce = indexOf(...existing);
                searchAll(oneByOne);
                searchAll(atOnce);

                let added = 0;
                for (const word of batch) if (oneByOne.add(word)) added++;
                expect(added).toBe(count);
                expect(atOnce.addAll(batch)).toBe(count);

                expect(atOnce.size).toBe(oneByOne.size);
                expect(searchAll(atOnce)).toEqual(searchAll(oneByOne));
                // Also the same as an index that never had a view
                expect(searchAll(atOnce)).toEqual(searchAll(indexOf(...existing, ...batch)));
            },
        );

        test.each([200, 300])("the index stays consistent after a batch of %p words", (count) => {
            const index = indexOf("alpha", "beta");
            words(index, "");
            const batch = makeWords(count, "y");
            index.addAll(batch);

            expect(index.delete(batch[0])).toBe(true);
            expect(index.add("Alpaca")).toBe(true);
            expect(index.addAll(["alpine", "Alpaca"])).toBe(1);

            const expected = indexOf("alpha", "beta", ...batch.slice(1), "Alpaca", "alpine");
            expect(searchAll(index)).toEqual(searchAll(expected));
            expect(words(index, "alp")).toEqual(["Alpaca", "alpha", "alpine"]);
        });

        test("a batch of known words keeps the views", () => {
            const known = makeWords(300, "x");
            const index = indexOf(...known);
            const before = searchAll(index);
            expect(index.addAll(known)).toBe(0);
            expect(searchAll(index)).toEqual(before);
        });
    });

    describe("fuzzy search", () => {
        test("prefix matches come first, then fuzzy matches", () => {
            const index = indexOf("markdown", "mkdir", "milk", "mkdocs");
            const result = index.search("mkd", fuzzy);
            expect(result.map((m) => [m.word, m.isPrefixMatch])).toEqual([
                ["mkdir", true],
                ["mkdocs", true],
                ["markdown", false],
            ]);
        });

        test("fuzzy matches are sorted by score", () => {
            const index = indexOf("abxxxxc", "abc_long_word", "axbxc", "abxc");
            const result = index.search("abc", fuzzy).filter((m) => !m.isPrefixMatch);
            // "abc_long_word" is a prefix match. "abxc" has one gap, "abxxxxc" one (longer), "axbxc" two.
            expect(result.map((m) => m.word)).toEqual(["abxc", "abxxxxc", "axbxc"]);
            expect(index.search("abc", fuzzy)[0]).toMatchObject({ word: "abc_long_word", isPrefixMatch: true });
        });

        test("fuzzy matches must start with the same character", () => {
            expect(words(indexOf("markdown", "amkd"), "mkd", fuzzy)).toEqual(["markdown"]);
        });

        test("no fuzzy matching for single character queries", () => {
            expect(words(indexOf("ab", "xa"), "a", fuzzy)).toEqual(["ab"]);
        });

        test("no fuzzy matching without the option", () => {
            expect(words(indexOf("markdown"), "mkd")).toEqual([]);
        });

        test("fuzzy matches are not repeated as prefix matches", () => {
            const result = words(indexOf("abc", "abxc", "ab"), "ab", fuzzy);
            expect(result).toEqual(["ab", "abc", "abxc"]);
        });

        test("fuzzy matches include the matched ranges", () => {
            const [m] = indexOf("markdown").search("mkd", fuzzy);
            expect(m).toMatchObject({ word: "markdown", isPrefixMatch: false });
            expect(m.matches).toEqual([
                [0, 1],
                [3, 5],
            ]);
            expect(m.score).toBeCloseTo(0.95);
        });

        test("fuzzy matching respects ignoreCase", () => {
            const index = indexOf("MarkDown");
            expect(words(index, "mkd", fuzzy)).toEqual(["MarkDown"]);
            expect(words(index, "mkd", { ...fuzzy, ignoreCase: false })).toEqual([]);
            expect(words(index, "MkD", { ...fuzzy, ignoreCase: false })).toEqual(["MarkDown"]);
        });

        test("fuzzy matching respects ignoreDiacritics", () => {
            expect(words(indexOf("mårkdöwn"), "mkdo", { ...fuzzy, ignoreDiacritics: true })).toEqual(["mårkdöwn"]);
            expect(words(indexOf("mårkdöwn"), "mkdo", fuzzy)).toEqual([]);
        });

        test("ranges are dropped if normalization changed the length", () => {
            // NFD input: "e" + combining grave, removing the diacritic shortens the key
            const [m] = indexOf("mèkd").search("mkd", { ...fuzzy, ignoreDiacritics: true });
            expect(m.word).toBe("mèkd");
            expect(m.matches).toEqual([]);
        });

        test("fuzzyLimit caps the fuzzy matches but never the prefix matches", () => {
            const prefix = Array.from({ length: 5 }, (_, i) => "ab" + i);
            const fuzzyWords = Array.from({ length: 10 }, (_, i) => "a" + "x".repeat(i + 1) + "b");
            const index = indexOf(...prefix, ...fuzzyWords);
            const result = index.search("ab", { ...fuzzy, fuzzyLimit: 3 });
            expect(result.filter((m) => m.isPrefixMatch)).toHaveLength(5);
            // The best scores (shortest gap / shortest words) survive
            expect(result.filter((m) => !m.isPrefixMatch).map((m) => m.word)).toEqual(["axb", "axxb", "axxxb"]);
        });

        test("default fuzzyLimit is 200", () => {
            const index = indexOf(...Array.from({ length: 300 }, (_, i) => "a" + i + "b"));
            expect(index.search("ab", fuzzy)).toHaveLength(200);
        });

        test("fuzzy search sees incrementally added words", () => {
            const index = indexOf("alpha");
            words(index, "ah", fuzzy);
            index.add("aha");
            index.add("axh");
            expect(words(index, "ah", fuzzy)).toEqual(["aha", "axh", "alpha"]);
        });
    });
});

describe("fuzzyMatch", () => {
    test("empty query matches everything with score 0", () => {
        expect(fuzzyMatch("", "anything")).toEqual({ score: 0, matches: [] });
        expect(fuzzyMatch("", "")).toEqual({ score: 0, matches: [] });
    });

    test("first character must match", () => {
        expect(fuzzyMatch("bc", "abc")).toBeNull();
        expect(fuzzyMatch("a", "")).toBeNull();
    });

    test("all characters must appear in order", () => {
        expect(fuzzyMatch("acb", "abc")).toBeNull();
        expect(fuzzyMatch("abcd", "abc")).toBeNull();
        expect(fuzzyMatch("aa", "ab")).toBeNull();
    });

    test("consecutive characters are merged into one range", () => {
        expect(fuzzyMatch("abc", "abcd")).toEqual({ score: 4 - 0.01, matches: [[0, 3]] });
    });

    test("exact match", () => {
        expect(fuzzyMatch("abc", "abc")).toEqual({ score: 4, matches: [[0, 3]] });
    });

    test("gaps create new ranges and cost score", () => {
        const m = fuzzyMatch("mkd", "markdown")!;
        expect(m.matches).toEqual([
            [0, 1],
            [3, 5],
        ]);
        expect(m.score).toBeCloseTo(2 - 1 - 0.05);
    });

    test("consecutive matches score higher than scattered ones", () => {
        expect(fuzzyMatch("abc", "abcxx")!.score).toBeGreaterThan(fuzzyMatch("abc", "axbxc")!.score);
    });

    test("shorter words score higher", () => {
        expect(fuzzyMatch("ab", "axb")!.score).toBeGreaterThan(fuzzyMatch("ab", "axbyyyy")!.score);
    });

    test("length limits the part of the key that is searched", () => {
        expect(fuzzyMatch("ac", "abcd", 2)).toBeNull();
        expect(fuzzyMatch("ac", "abcd", 3)).toEqual({
            score: -1 - 0.01,
            matches: [
                [0, 1],
                [2, 3],
            ],
        });
        expect(fuzzyMatch("ac", "abc\u0000ABC", 3)).toEqual(fuzzyMatch("ac", "abc"));
    });

    test("matches greedily", () => {
        expect(fuzzyMatch("ab", "aab")!.matches).toEqual([
            [0, 1],
            [2, 3],
        ]);
    });
});
