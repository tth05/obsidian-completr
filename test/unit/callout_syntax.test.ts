import { describe, expect, test } from "bun:test";
import {
    extractBlockQuotePrefix,
    extractCalloutHeader,
    getCalloutCompletion,
} from "../../src/provider/callout_syntax.ts";

describe("extractBlockQuotePrefix", () => {
    test.each([
        ["> text", { text: "> ", depth: 1, chOffset: 2 }],
        [">text", { text: ">", depth: 1, chOffset: 1 }],
        ["> > text", { text: "> > ", depth: 2, chOffset: 4 }],
        [">>text", { text: ">>", depth: 2, chOffset: 2 }],
        ["  >  text", { text: "  >  ", depth: 1, chOffset: 5 }],
        [">\t>\ttext", { text: ">\t>\t", depth: 2, chOffset: 4 }],
        [">", { text: ">", depth: 1, chOffset: 1 }],
        ["> > > ", { text: "> > > ", depth: 3, chOffset: 6 }],
    ])("%p", (line, expected) => {
        expect(extractBlockQuotePrefix(line)).toEqual(expected);
    });

    test.each(["text", "", "  text > quote", "a > b"])("no block quote in %p", (line) => {
        expect(extractBlockQuotePrefix(line)).toBeNull();
    });
});

describe("extractCalloutHeader", () => {
    test("complete header with fold marker and title", () => {
        expect(extractCalloutHeader("[!note]- My Title")).toEqual({
            type: { start: 0, end: 7, text: "note", rawText: "[!note]" },
            foldable: { start: 7, end: 8, text: "-", rawText: "- " },
            title: { start: 9, end: 17, text: "My Title", rawText: "My Title" },
        });
    });

    test("header without fold marker and title", () => {
        expect(extractCalloutHeader("[!info]")).toEqual({
            type: { start: 0, end: 7, text: "info", rawText: "[!info]" },
            foldable: { start: 7, end: 7, text: "", rawText: "" },
            title: { start: 7, end: 7, text: "", rawText: "" },
        });
    });

    test("title without fold marker", () => {
        const header = extractCalloutHeader("[!tip] Title ")!;
        expect(header.foldable).toEqual({ start: 6, end: 6, text: "", rawText: " " });
        expect(header.title).toEqual({ start: 7, end: 13, text: "Title", rawText: "Title " });
    });

    test("fold marker without space", () => {
        const header = extractCalloutHeader("[!tip]+Title")!;
        expect(header.foldable.rawText).toBe("+");
        expect(header.title.rawText).toBe("Title");
    });

    test("the type is trimmed", () => {
        expect(extractCalloutHeader("[! warning ]")!.type).toEqual({
            start: 0,
            end: 12,
            text: "warning",
            rawText: "[! warning ]",
        });
    });

    test("empty type", () => {
        expect(extractCalloutHeader("[!]")!.type.text).toBe("");
        expect(extractCalloutHeader("[!")!.type.text).toBe("");
    });

    test("partial header (still typing the type)", () => {
        expect(extractCalloutHeader("[!no")).toEqual({
            type: { start: 0, end: 4, text: "no", rawText: "[!no" },
            foldable: { start: -1, end: -1, text: "", rawText: "" },
            title: { start: -1, end: -1, text: "", rawText: "" },
        });
    });

    test("the exclamation mark is optional", () => {
        expect(extractCalloutHeader("[note]")!.type.text).toBe("note");
        expect(extractCalloutHeader("[no")!.type.text).toBe("no");
    });

    test.each(["", "text", " [!note]", "x[!note]"])("not a header: %p", (line) => {
        expect(extractCalloutHeader(line)).toBeNull();
    });
});

describe("getCalloutCompletion", () => {
    /** `|` marks the cursor. */
    function complete(lineWithCursor: string, lineAbove: string | null = null) {
        const ch = lineWithCursor.indexOf("|");
        return getCalloutCompletion(lineWithCursor.replace("|", ""), lineAbove, ch);
    }

    test("typing the type", () => {
        expect(complete("> [!no|")).toEqual({ search: "no", start: 2, suffix: " " });
    });

    test("search is lower case", () => {
        expect(complete("> [!NoTe|")!.search).toBe("note");
    });

    test("only the part in front of the cursor is searched", () => {
        expect(complete("> [!no|te]")!.search).toBe("no");
        expect(complete("> [!|note]")!.search).toBe("");
        expect(complete("> [|!note]")!.search).toBe("");
    });

    test("cursor right before the closing bracket", () => {
        expect(complete("> [!note|]")).toEqual({ search: "note", start: 2, suffix: " " });
    });

    test("cursor outside the type", () => {
        expect(complete("> |[!note]")).toBeNull();
        expect(complete("> [!note]|")).toBeNull();
        expect(complete("> [!note] Ti|tle")).toBeNull();
        expect(complete(">| [!note]")).toBeNull();
    });

    test("keeps the fold marker and title", () => {
        expect(complete("> [!no|]- My Title")).toEqual({ search: "no", start: 2, suffix: "- My Title" });
        expect(complete("> [!no|]+")).toEqual({ search: "no", start: 2, suffix: "+ " });
        expect(complete("> [!no|]+Title")).toEqual({ search: "no", start: 2, suffix: "+ Title" });
        expect(complete("> [!no|] Title")).toEqual({ search: "no", start: 2, suffix: " Title" });
        expect(complete("> [!no|]   Title")).toEqual({ search: "no", start: 2, suffix: "   Title" });
    });

    test("whitespace in the type", () => {
        expect(complete("> [! no|]")!.search).toBe("no");
    });

    test("nested quotes", () => {
        expect(complete("> > [!ti|", "> outer")).toEqual({ search: "ti", start: 4, suffix: " " });
        expect(complete(">>[!ti|")).toEqual({ search: "ti", start: 2, suffix: " " });
        expect(complete("  > [!ti|")).toEqual({ search: "ti", start: 4, suffix: " " });
    });

    test("continuation lines of a block quote are not callout headers", () => {
        expect(complete("> [!no|", "> previous line")).toBeNull();
        expect(complete("> [!no|", ">")).toBeNull();
        expect(complete("> > [!no|", "> > previous")).toBeNull();
        expect(complete("> [!no|", "> > deeper")).toBeNull();
    });

    test("a line above that is not a block quote is fine", () => {
        expect(complete("> [!no|", "")).not.toBeNull();
        expect(complete("> [!no|", "text")).not.toBeNull();
    });

    test("not a block quote", () => {
        expect(complete("[!no|")).toBeNull();
        expect(complete("text [!no|")).toBeNull();
    });

    test("block quote without callout header", () => {
        expect(complete("> no|")).toBeNull();
        expect(complete("> text [!no|")).toBeNull();
    });
});
