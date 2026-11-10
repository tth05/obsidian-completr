import { describe, expect, test } from "bun:test";
import {
    applyTypedCasing,
    compileCharacterClass,
    DEFAULT_CHARACTER_REGEX,
    findFrontMatterBounds,
    getContinuationPrefix,
    isInUnclosedInlineMath,
    isWordChar,
    LEGACY_CHARACTER_REGEX,
    matchWordBackwards,
    maybeLowerCase,
    removeDiacritics,
    summarize,
} from "../../src/text.ts";

const defaultRegex = compileCharacterClass(DEFAULT_CHARACTER_REGEX)!;
const isDefaultWordChar = (c: string) => defaultRegex.test(c);

/** Matches the word in front of the end of `line`. */
const wordAtEnd = (line: string, maxLookBack?: number) =>
    matchWordBackwards(line, line.length, isDefaultWordChar, maxLookBack);

describe("compileCharacterClass", () => {
    test("compiles a simple class matching single characters", () => {
        const regex = compileCharacterClass("a-z")!;
        expect(regex).toBeInstanceOf(RegExp);
        expect(regex.test("q")).toBe(true);
        expect(regex.test("Q")).toBe(false);
        expect(regex.flags).toBe("u");
    });

    test("is not global, so repeated tests don't depend on each other", () => {
        const regex = compileCharacterClass("a-z")!;
        expect(regex.global).toBe(false);
        expect(regex.test("a")).toBe(true);
        expect(regex.test("a")).toBe(true);
    });

    test.each(["z-a", "\\p{NotAProperty}", "]", "\\"])("returns null for the invalid class %p", (input) => {
        expect(compileCharacterClass(input)).toBeNull();
    });

    test("the legacy regex still compiles", () => {
        const regex = compileCharacterClass(LEGACY_CHARACTER_REGEX)!;
        expect(regex.test("ß")).toBe(true);
        expect(regex.test("é")).toBe(false);
    });
});

describe("isWordChar", () => {
    test("tests a character against the character class", () => {
        expect(isWordChar("q", "a-z")).toBe(true);
        expect(isWordChar("Q", "a-z")).toBe(false);
        expect(isWordChar("5", "a-z0-9")).toBe(true);
        expect(isWordChar("-", "a-z0-9")).toBe(false);
    });

    test("the default class matches letters of every script, but no digits or punctuation", () => {
        for (const c of ["a", "ß", "Ω", "ж", "字", "𠀀"]) expect(isWordChar(c, DEFAULT_CHARACTER_REGEX)).toBe(true);
        for (const c of ["1", " ", "-", ":", "\\", "😀"]) expect(isWordChar(c, DEFAULT_CHARACTER_REGEX)).toBe(false);
    });

    test("an empty string is never a word character", () => {
        expect(isWordChar("", DEFAULT_CHARACTER_REGEX)).toBe(false);
        expect(isWordChar("", "a-z")).toBe(false);
    });

    test.each(["z-a", "\\p{NotAProperty}", "]", "\\"])("the invalid class %p falls back to the default", (cls) => {
        expect(isWordChar("é", cls)).toBe(true);
        expect(isWordChar("z", cls)).toBe(true);
        expect(isWordChar("1", cls)).toBe(false);
        expect(isWordChar("]", cls)).toBe(false);
    });

    test("switching between classes always uses the given one", () => {
        expect(isWordChar("1", "0-9")).toBe(true);
        expect(isWordChar("1", "a-z")).toBe(false);
        expect(isWordChar("1", "0-9")).toBe(true);
        expect(isWordChar("1", "z-a")).toBe(false);
        expect(isWordChar("1", "0-9")).toBe(true);
    });

    test("repeated calls with the same class give the same answer", () => {
        for (let i = 0; i < 3; i++) {
            expect(isWordChar("a", "a-z")).toBe(true);
            expect(isWordChar("A", "a-z")).toBe(false);
        }
    });

    test("works as the predicate of matchWordBackwards", () => {
        const line = "see my-note";
        expect(matchWordBackwards(line, line.length, (c) => isWordChar(c, DEFAULT_CHARACTER_REGEX))).toEqual({
            query: "note",
            separatorChar: "-",
        });
        expect(matchWordBackwards(line, line.length, (c) => isWordChar(c, "a-z\\-"))).toEqual({
            query: "my-note",
            separatorChar: " ",
        });
    });
});

describe("summarize", () => {
    test("a single line is returned as is", () => {
        expect(summarize("Hello world")).toBe("Hello world");
    });

    test("only the first line by default, with an ellipsis if there is more", () => {
        expect(summarize("## Meeting\nAttendees:")).toBe("## Meeting …");
    });

    test("lines are trimmed", () => {
        expect(summarize("   indented\t")).toBe("indented");
        expect(summarize("  a  \n  b  ", 2)).toBe("a ⏎ b");
    });

    test("empty and blank lines are skipped and don't count", () => {
        expect(summarize("\n\n  \nfirst\n\nsecond\n")).toBe("first …");
        expect(summarize("\n\nonly\n\n")).toBe("only");
        expect(summarize("a\n\n\nb\n \nc", 2)).toBe("a ⏎ b …");
    });

    test("several lines are joined with a return symbol", () => {
        expect(summarize("a\nb\nc", 2)).toBe("a ⏎ b …");
        expect(summarize("a\nb\nc", 3)).toBe("a ⏎ b ⏎ c");
        expect(summarize("a\nb\nc", 10)).toBe("a ⏎ b ⏎ c");
    });

    test("CRLF line breaks", () => {
        expect(summarize("a\r\nb\r\n", 2)).toBe("a ⏎ b");
        expect(summarize("a\r\nb")).toBe("a …");
    });

    test("empty or blank text", () => {
        expect(summarize("")).toBe("");
        expect(summarize(" \n\t\n")).toBe("");
    });

    test("placeholders are kept", () => {
        expect(summarize("Dear {{name}},\n\n{{cursor}}")).toBe("Dear {{name}}, …");
    });
});

describe("DEFAULT_CHARACTER_REGEX", () => {
    test.each([
        ["Latin", "aZéßø"],
        ["Greek (#85)", "αβγΩάώ"],
        ["Cyrillic (#85)", "жЖйЁщ"],
        // Vowel signs (Mc/Mn) and virama are combining marks, they must be part of a word (#87)
        ["Devanagari incl. vowel signs and virama (#87)", "किताबनमस्तेहिंदी"],
        ["CJK", "漢字かなカナ한국어"],
        ["Arabic", "مرحبا"],
        ["combining diacritic", "é"],
    ])("matches %s", (_, chars) => {
        for (const c of chars) expect(isDefaultWordChar(c)).toBe(true);
    });

    test.each([" ", "1", "_", "-", ".", "$", "\\", "😀", "\t", "["])("does not match %p", (c) => {
        expect(isDefaultWordChar(c)).toBe(false);
    });

    test("whole Devanagari words are matched backwards (#87)", () => {
        expect(wordAtEnd("मैं किताब")).toEqual({ query: "किताब", separatorChar: " " });
        expect(wordAtEnd("नमस्ते")).toEqual({ query: "नमस्ते", separatorChar: null });
        expect(wordAtEnd("हिंदी")).toEqual({ query: "हिंदी", separatorChar: null });
    });

    test("whole Greek and Cyrillic words are matched backwards (#85)", () => {
        expect(wordAtEnd("ένα παράδειγμα").query).toBe("παράδειγμα");
        expect(wordAtEnd("Привет мир").query).toBe("мир");
    });
});

describe("matchWordBackwards", () => {
    const azRegex = /[a-z]/;
    const az = (c: string) => azRegex.test(c);

    test("returns the word in front of the cursor and the separator", () => {
        expect(matchWordBackwards("hello world", 11, az)).toEqual({ query: "world", separatorChar: " " });
    });

    test("stops at the cursor, not at the end of the line", () => {
        expect(matchWordBackwards("hello world", 8, az)).toEqual({ query: "wo", separatorChar: " " });
    });

    test("word at the start of the line has no separator", () => {
        expect(matchWordBackwards("hello", 5, az)).toEqual({ query: "hello", separatorChar: null });
    });

    test("cursor right after a separator gives an empty query", () => {
        expect(matchWordBackwards("foo \\", 5, az)).toEqual({ query: "", separatorChar: "\\" });
        expect(matchWordBackwards("foo ", 4, az)).toEqual({ query: "", separatorChar: " " });
    });

    test("empty line", () => {
        expect(matchWordBackwards("", 0, az)).toEqual({ query: "", separatorChar: null });
    });

    test("cursor at position 0", () => {
        expect(matchWordBackwards("hello", 0, az)).toEqual({ query: "", separatorChar: null });
    });

    test("backslash separator (LaTeX)", () => {
        expect(matchWordBackwards("$\\frac", 6, az)).toEqual({ query: "frac", separatorChar: "\\" });
    });

    test("respects the look back limit", () => {
        const line = "x" + "a".repeat(10);
        expect(matchWordBackwards(line, line.length, az, 4)).toEqual({ query: "aaaa", separatorChar: null });
        // Exactly reaching the separator
        expect(matchWordBackwards("x aaaa", 6, az, 4)).toEqual({ query: "aaaa", separatorChar: null });
        expect(matchWordBackwards("x aaaa", 6, az, 5)).toEqual({ query: "aaaa", separatorChar: " " });
    });

    test("look back distance 0 never matches", () => {
        expect(matchWordBackwards("hello", 5, az, 0)).toEqual({ query: "", separatorChar: null });
    });

    test("default look back distance is 50", () => {
        const line = "a".repeat(60);
        expect(matchWordBackwards(line, 60, az).query).toHaveLength(50);
    });

    test("cursor beyond the end of the line", () => {
        expect(matchWordBackwards("ab", 5, az)).toEqual({ query: "ab", separatorChar: null });
    });

    test("letters outside the BMP are kept together (surrogate pairs)", () => {
        // U+20000 and U+20001 are CJK ideographs (category Lo), each 2 UTF-16 units long
        expect(wordAtEnd("foo 𠀀𠀁")).toEqual({ query: "𠀀𠀁", separatorChar: " " });
        // Mathematical script letters
        expect(wordAtEnd("x 𝒜b𝒞")).toEqual({ query: "𝒜b𝒞", separatorChar: " " });
    });

    test("an emoji separator is returned as a whole code point", () => {
        expect(wordAtEnd("😀hello")).toEqual({ query: "hello", separatorChar: "😀" });
        expect(wordAtEnd("a😀")).toEqual({ query: "", separatorChar: "😀" });
    });

    test("isWordChar is called with whole code points", () => {
        const seen: string[] = [];
        matchWordBackwards("a😀𠀀", 5, (c) => {
            seen.push(c);
            return c !== "😀";
        });
        expect(seen).toEqual(["𠀀", "😀"]);
    });

    test("a surrogate pair straddling the look back limit is included as a whole", () => {
        // "x" + U+20000 (2 units). The limit falls between the two surrogates.
        expect(wordAtEnd("x𠀀", 1)).toEqual({ query: "𠀀", separatorChar: null });
    });

    test("lone surrogates do not crash", () => {
        expect(matchWordBackwards("\udc00ab", 3, az)).toEqual({ query: "ab", separatorChar: "\udc00" });
        expect(matchWordBackwards("a\ud800", 2, az)).toEqual({ query: "", separatorChar: "\ud800" });
    });

    test("combining characters stay part of the word", () => {
        expect(wordAtEnd("café")).toEqual({ query: "café", separatorChar: null });
    });
});

describe("removeDiacritics", () => {
    test.each([
        ["Hèllò", "Hello"],
        ["Ångström", "Angstrom"],
        ["naïve café", "naive cafe"],
        ["Crème Brûlée", "Creme Brulee"],
        ["é", "e"],
        ["ά", "α"],
        ["", ""],
        ["plain", "plain"],
    ])("%p -> %p", (input, expected) => {
        expect(removeDiacritics(input)).toBe(expected);
    });

    test("letters that are not decomposable are kept", () => {
        expect(removeDiacritics("ßøæđł")).toBe("ßøæđł");
    });

    test("does not strip Devanagari vowel signs, virama, anusvara or nukta", () => {
        for (const word of ["किताब", "नमस्ते", "हिंदी", "पढ़ना", "ड़"]) {
            expect(removeDiacritics(word)).toBe(word.normalize("NFC"));
        }
    });

    test("removes exactly the combining diacritical marks block (U+0300 to U+036F)", () => {
        expect(removeDiacritics("àbͯc")).toBe("abc");
        // The characters right before and after the block
        expect(removeDiacritics("a˿bͰc")).toBe("a˿bͰc");
    });

    test("output is NFC", () => {
        expect(removeDiacritics("ạ̄")).toBe("a"); // both marks are in the combining diacritics block
        expect(removeDiacritics("한국어".normalize("NFD"))).toBe("한국어");
    });
});

describe("maybeLowerCase", () => {
    test("only lower cases when asked to", () => {
        expect(maybeLowerCase("HeLLo", true)).toBe("hello");
        expect(maybeLowerCase("HeLLo", false)).toBe("HeLLo");
    });
});

describe("applyTypedCasing", () => {
    test("keeps the diacritics of the word if the user typed without them (#98)", () => {
        expect(applyTypedCasing("asi", "āṣīṛū")).toBe("āṣīṛū");
    });

    test("upper case typed characters are applied to the word (#98)", () => {
        expect(applyTypedCasing("ASI", "āṣīṛū")).toBe("ĀṢĪṛū");
        expect(applyTypedCasing("As", "āṣīṛū")).toBe("Āṣīṛū");
    });

    test("keeps the typed casing", () => {
        expect(applyTypedCasing("Hell", "hello")).toBe("Hello");
        expect(applyTypedCasing("HELL", "hello")).toBe("HELLo");
        expect(applyTypedCasing("hEl", "Hello")).toBe("hEllo");
    });

    test("identical prefix returns the word", () => {
        expect(applyTypedCasing("hel", "hello")).toBe("hello");
        expect(applyTypedCasing("", "Hello")).toBe("Hello");
    });

    test("typed characters without case keep the word's character", () => {
        expect(applyTypedCasing("1", "xy")).toBe("xy");
    });

    test("decomposed typed text is normalized first", () => {
        expect(applyTypedCasing("Ā", "āb")).toBe("Āb");
        expect(applyTypedCasing("ā", "āb")).toBe("āb");
    });

    test("decomposed words are returned in NFC", () => {
        expect(applyTypedCasing("A", "āb")).toBe("Āb");
    });

    test("characters outside the BMP are handled as a whole", () => {
        expect(applyTypedCasing("𐐨", "𐐀x")).toBe("𐐨x"); // Deseret capital/small letter
        expect(applyTypedCasing("X", "𠀀y")).toBe("𠀀y");
    });

    test("result has the length of the word, not the typed text", () => {
        expect(applyTypedCasing("HELLOWORLD", "hello")).toBe("HELLO");
    });
});

describe("findFrontMatterBounds", () => {
    const bounds = (lines: string[], maxLines?: number) =>
        findFrontMatterBounds((i) => lines[i], lines.length, maxLines);

    test("finds a simple block", () => {
        expect(bounds(["---", "a: 1", "---", "text"])).toEqual({ startLine: 0, endLine: 2 });
    });

    test("empty front matter", () => {
        expect(bounds(["---", "---"])).toEqual({ startLine: 0, endLine: 1 });
    });

    test("closing with '...'", () => {
        expect(bounds(["---", "a: 1", "..."])).toEqual({ startLine: 0, endLine: 2 });
    });

    test("trailing whitespace on the delimiters is allowed", () => {
        expect(bounds(["---  ", "a: 1", "---\t"])).toEqual({ startLine: 0, endLine: 2 });
    });

    test("must start on the first line", () => {
        expect(bounds(["", "---", "a: 1", "---"])).toBeNull();
        expect(bounds(["text", "---", "a: 1", "---"])).toBeNull();
    });

    test("leading whitespace or longer dashes are not delimiters", () => {
        expect(bounds([" ---", "a: 1", "---"])).toBeNull();
        expect(bounds(["----", "a: 1", "---"])).toBeNull();
        expect(bounds(["---", "a: 1", "----", "b: 2", "---"])).toEqual({ startLine: 0, endLine: 4 });
    });

    test("unclosed block", () => {
        expect(bounds(["---", "a: 1", "b: 2"])).toBeNull();
    });

    test("single line document", () => {
        expect(bounds(["---"])).toBeNull();
        expect(findFrontMatterBounds(() => "", 0)).toBeNull();
    });

    test("the closing delimiter must be within maxLines", () => {
        const lines = ["---", "a", "b", "c", "---"];
        expect(bounds(lines, 4)).toBeNull();
        expect(bounds(lines, 5)).toEqual({ startLine: 0, endLine: 4 });
    });

    test("does not read beyond the needed lines", () => {
        const read: number[] = [];
        findFrontMatterBounds((i) => {
            read.push(i);
            return i === 0 || i === 2 ? "---" : "x";
        }, 1000);
        expect(read).toEqual([0, 1, 2]);
    });
});

describe("isInUnclosedInlineMath", () => {
    const atEnd = (line: string, skipInlineCode?: boolean) => isInUnclosedInlineMath(line, line.length, skipInlineCode);

    test("open dollar", () => {
        expect(atEnd("$x")).toBe(true);
        expect(atEnd("text $\\fr")).toBe(true);
    });

    test("closed math", () => {
        expect(atEnd("$x$ y")).toBe(false);
        expect(atEnd("$a$ $b$")).toBe(false);
    });

    test("second math span", () => {
        expect(atEnd("$a$ and $b")).toBe(true);
    });

    test("no dollar", () => {
        expect(atEnd("plain text")).toBe(false);
        expect(atEnd("")).toBe(false);
    });

    test("only looks at the text in front of the cursor", () => {
        expect(isInUnclosedInlineMath("$ab$ cd", 2)).toBe(true);
        expect(isInUnclosedInlineMath("$ab$ cd", 4)).toBe(false);
        expect(isInUnclosedInlineMath("$ab$", 0)).toBe(false);
    });

    test("escaped dollars are ignored", () => {
        expect(atEnd("\\$x")).toBe(false);
        expect(atEnd("costs \\$5 and \\$6")).toBe(false);
        expect(atEnd("$a \\$ b")).toBe(true);
        expect(atEnd("\\\\$x")).toBe(true); // escaped backslash, the dollar is real
    });

    test("$$ pairs are skipped", () => {
        expect(atEnd("$$x")).toBe(false);
        expect(atEnd("$$x$$")).toBe(false);
        expect(atEnd("$$x$$ $y")).toBe(true);
    });

    test("dollars inside inline code are ignored", () => {
        expect(atEnd("`$x")).toBe(false);
        expect(atEnd("`code $` $x")).toBe(true);
        expect(atEnd("`a` $x")).toBe(true);
        expect(atEnd("`$a` b")).toBe(false);
    });

    test("inline code with multiple backticks only closes with the same number", () => {
        expect(atEnd("``a ` $x")).toBe(false);
        expect(atEnd("``a ` $b`` $x")).toBe(true);
        expect(atEnd("```a`` $x")).toBe(false);
    });

    test("backticks inside math do not start code", () => {
        expect(atEnd("$`x")).toBe(true);
        expect(atEnd("$`x$ $y")).toBe(true);
    });

    test("with skipInlineCode = false backticks are ordinary characters", () => {
        expect(atEnd("`$x", false)).toBe(true);
        expect(atEnd("`$x$ `", false)).toBe(false);
    });
});

describe("getContinuationPrefix", () => {
    test.each([
        ["plain text", ""],
        ["", ""],
        ["  indented", "  "],
        ["\tindented", "\t"],
        ["> quote", "> "],
        [">quote", ">"],
        ["> > nested", "> > "],
        [">> nested", ">> "],
        ["  > indented quote", "  > "],
        ["- item", "  "],
        ["* item", "  "],
        ["+ item", "  "],
        ["  - nested item", "    "],
        ["\t- item", "\t  "],
        ["1. item", "   "],
        ["10) item", "    "],
        ["123. item", "     "],
        ["> - quoted item", ">   "],
        ["> > 1. nested quoted item", "> >    "],
        ["-not a list", ""],
        ["1.not a list", ""],
        ["- [ ] task", "  "],
    ])("%p -> %p", (line, expected) => {
        expect(getContinuationPrefix(line)).toBe(expected);
    });
});
