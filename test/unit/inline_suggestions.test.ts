import { describe, expect, test } from "bun:test";
import { EditorState, Text, type TransactionSpec } from "@codemirror/state";
import {
    findInlineSuggestion,
    getInlineSuggestion,
    getInsertedText,
    type InlineSuggestion,
    inlineSuggestionField,
    isBeforeWordChar,
    setInlineSuggestion,
} from "../../src/inline_suggestions.ts";
import { type Suggestion, suggestion } from "../../src/provider/provider.ts";
import { DEFAULT_CHARACTER_REGEX } from "../../src/text.ts";

/**
 * A document with `|` marking the cursor and (optionally) `^` marking the start of the typed word. Without `^`, the
 * word starts after the last space or line break in front of the cursor.
 */
function at(text: string) {
    const startMark = text.indexOf("^");
    if (startMark !== -1) text = text.replace("^", "");
    const cursor = text.indexOf("|");
    if (cursor === -1) throw new Error("No cursor marker in: " + text);
    const doc = Text.of(text.replace("|", "").split("\n"));
    const queryStart =
        startMark !== -1 ? startMark : Math.max(text.lastIndexOf(" ", cursor), text.lastIndexOf("\n", cursor)) + 1;
    return { doc, cursor, queryStart };
}

/** The text an inline suggestion would show, null if it can't be shown. */
function ghost(text: string, s: Suggestion): string | null {
    const { doc, cursor, queryStart } = at(text);
    return getInlineSuggestion(s, doc, cursor, queryStart)?.text ?? null;
}

describe("getInlineSuggestion", () => {
    test("shows the rest of a word", () => {
        const { doc, cursor, queryStart } = at("Some xyl|");
        expect(getInlineSuggestion(suggestion("xylophone"), doc, cursor, queryStart)).toEqual({
            suggestion: suggestion("xylophone"),
            from: 5,
            pos: 8,
            text: "ophone",
        });
    });

    test("the typed text must be kept exactly, including its case", () => {
        expect(ghost("Xyl|", suggestion("xylophone"))).toBeNull();
        expect(ghost("xyl|", suggestion("Xylophone"))).toBeNull();
        expect(ghost("Xyl|", suggestion("Xylophone"))).toBe("ophone");
        // Ignore-case & append keeps the typed casing, so this one can be shown
        expect(ghost("XYL|", suggestion("XYLophone"))).toBe("ophone");
        // A fuzzy match doesn't start with the typed text
        expect(ghost("mkd|", suggestion("markdown"))).toBeNull();
    });

    test("nothing to show: the suggestion is exactly what was typed", () => {
        expect(ghost("xylem|", suggestion("xylem"))).toBeNull();
    });

    test("compares what is inserted, not the name shown in the popup", () => {
        expect(ghost("$\\^fr|$", suggestion("\\frac{#}{#}", "frac{#}{#}", { snippet: "latex" }))).toBe("ac{}{}");
        expect(ghost("$\\^ve|$", suggestion("\\curlyvee", "curlyvee", { snippet: "latex" }))).toBeNull();
    });

    test("snippets show their text without placeholder markers, pre-filled placeholders keep their text", () => {
        expect(ghost("$\\^su|$", suggestion("\\sum", "sum_{#}^{#}~", { snippet: "latex" }))).toBe("m_{}^{}");
        const template = suggestion("meet", "meeting {{title}} at {{}}{{cursor}}", { snippet: "template" });
        expect(ghost("^mee|", template)).toBe("ting title at ");
        expect(getInsertedText(template)).toBe("meeting title at ");
        expect(getInsertedText(suggestion("a#b", "a#b"))).toBe("a#b");
    });

    test("multi-line suggestions can't be shown", () => {
        expect(ghost("^mee|", suggestion("meeting", "meeting\nnotes"))).toBeNull();
        expect(ghost("^mee|", suggestion("meeting", "meeting {{}}\n{{cursor}}", { snippet: "template" }))).toBeNull();
        // ...unless what is left after the typed text is a single line
        expect(ghost("^line1\nli|", suggestion("x", "line1\nline2", { overrideStart: { line: 0, ch: 0 } }))).toBe(
            "ne2",
        );
    });

    test("starts at overrideStart instead of the start of the query", () => {
        // Snippet names like ":sig" start with a non-word character, which isn't part of the query
        const sig = suggestion(":sig", "Best regards", { overrideStart: { line: 0, ch: 3 }, snippet: "template" });
        expect(ghost("Hi :si|", sig)).toBeNull();
        const sigSnippet = suggestion(":sig", ":signature", { overrideStart: { line: 0, ch: 3 } });
        expect(ghost("Hi :si|", sigSnippet)).toBe("gnature");
        const { doc, cursor, queryStart } = at("Hi :si|");
        expect(getInlineSuggestion(sigSnippet, doc, cursor, queryStart)?.from).toBe(3);
    });

    test("overrideStart behind the cursor can't be shown", () => {
        expect(ghost("ab|cd", suggestion("cdef", "cdef", { overrideStart: { line: 0, ch: 3 } }))).toBeNull();
    });

    test("must end at the cursor", () => {
        const until = (ch: number) =>
            suggestion("> [!note]", "[!note]", { overrideStart: { line: 0, ch: 2 }, overrideEnd: { line: 0, ch } });
        expect(ghost("> [!no|", until(6))).toBe("te]");
        // Clamped to the end of the line, like the popup does
        expect(ghost("> [!no|", until(99))).toBe("te]");
        expect(ghost("> [!no|]", until(7))).toBeNull();
        expect(ghost("> [!no|", until(5))).toBeNull();
    });
});

describe("findInlineSuggestion", () => {
    test("takes the first suggestion that can be shown", () => {
        const { doc, cursor, queryStart } = at("Xyl|");
        const list = [suggestion("xylem"), suggestion("Xy"), suggestion("Xylophone"), suggestion("Xylitol")];
        expect(findInlineSuggestion(list, doc, cursor, queryStart)?.suggestion.displayName).toBe("Xylophone");
    });

    test("null if none can be shown", () => {
        const { doc, cursor, queryStart } = at("xyl|");
        expect(findInlineSuggestion([suggestion("Xylem"), suggestion("xyl")], doc, cursor, queryStart)).toBeNull();
        expect(findInlineSuggestion([], doc, cursor, queryStart)).toBeNull();
    });
});

describe("isBeforeWordChar", () => {
    const check = (text: string) => {
        const { doc, cursor } = at(text);
        return isBeforeWordChar(doc, cursor, DEFAULT_CHARACTER_REGEX);
    };

    test("a word character after the cursor", () => {
        expect(check("xyl|em")).toBe(true);
        expect(check("xyl|Ém")).toBe(true);
        // Outside the BMP
        expect(check("xyl|𝒜")).toBe(true);
    });

    test("no word character after the cursor", () => {
        expect(check("xyl|")).toBe(false);
        expect(check("xyl| more")).toBe(false);
        expect(check("$xyl|$")).toBe(false);
        expect(check("xyl|\nnext")).toBe(false);
        expect(check("xyl|1")).toBe(false);
    });

    test("uses the configured word characters", () => {
        const { doc, cursor } = at("xyl|1");
        expect(isBeforeWordChar(doc, cursor, "a-z0-9")).toBe(true);
    });
});

describe("inlineSuggestionField", () => {
    /** An editor state at `text` showing an inline suggestion with the rest `rest`. */
    function setup(text: string, rest: string) {
        const { doc, cursor, queryStart } = at(text);
        let state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: inlineSuggestionField });
        const value: InlineSuggestion = { suggestion: suggestion("x"), from: queryStart, pos: cursor, text: rest };
        state = state.update({ effects: setInlineSuggestion.of(value) }).state;
        return {
            get state() {
                return state;
            },
            get value() {
                return state.field(inlineSuggestionField);
            },
            dispatch(spec: TransactionSpec) {
                state = state.update(spec).state;
            },
            type(text: string) {
                state = state.update(state.replaceSelection(text), { userEvent: "input.type" }).state;
            },
        };
    }

    test("typing the next character keeps the rest", () => {
        const editor = setup("xyl|", "ophone");
        editor.type("o");
        expect(editor.value).toMatchObject({ from: 0, pos: 4, text: "phone" });
        editor.type("p");
        expect(editor.value).toMatchObject({ from: 0, pos: 5, text: "hone" });
    });

    test("typing something else, or all of it, hides it", () => {
        const other = setup("xyl|", "ophone");
        other.type("e");
        expect(other.value).toBeNull();
        const all = setup("xyl|", "o");
        all.type("o");
        expect(all.value).toBeNull();
    });

    test("pasting, deleting and moving the cursor hide it", () => {
        const paste = setup("xyl|", "ophone");
        paste.dispatch({ changes: { from: 3, insert: "o" }, selection: { anchor: 4 }, userEvent: "input.paste" });
        expect(paste.value).toBeNull();

        const remove = setup("xyl|", "ophone");
        remove.dispatch({ changes: { from: 2, to: 3 }, selection: { anchor: 2 }, userEvent: "delete.backward" });
        expect(remove.value).toBeNull();

        const move = setup("xyl|", "ophone");
        move.dispatch({ selection: { anchor: 1 } });
        expect(move.value).toBeNull();
    });

    test("transactions that change neither the document nor the cursor keep it", () => {
        const editor = setup("xyl|", "ophone");
        editor.dispatch({ selection: { anchor: 3 } });
        editor.dispatch({ scrollIntoView: true });
        expect(editor.value).toMatchObject({ pos: 3, text: "ophone" });
    });

    test("a change that keeps the text (Obsidian rendering math) keeps it, unless the cursor moves", () => {
        const editor = setup("$xyl|$", "ophone");
        editor.dispatch({ changes: { from: 4, to: 5, insert: "$" } });
        expect(editor.value).toMatchObject({ pos: 4, text: "ophone" });
        editor.dispatch({ changes: { from: 0, to: 1, insert: "$" }, selection: { anchor: 5 } });
        expect(editor.value).toBeNull();
    });

    test("is replaced or removed by the effect", () => {
        const editor = setup("xyl|", "ophone");
        editor.dispatch({ effects: setInlineSuggestion.of(null) });
        expect(editor.value).toBeNull();
    });
});
