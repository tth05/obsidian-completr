import { describe, expect, test } from "bun:test";
import { WordIndex } from "../../src/word_index.ts";

const opts = { ignoreCase: true, ignoreDiacritics: false, fuzzy: false };

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
});
