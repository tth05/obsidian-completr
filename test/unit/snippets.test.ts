import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    hasActiveSnippet,
    insertSnippet,
    isInPlaceholder,
    jumpToNextPlaceholder,
    parseSnippet,
    snippetExtension,
} from "../../src/snippets.ts";

/**
 * A real EditorView needs a DOM. The snippet functions only use `state` and `dispatch`, which this stand-in
 * implements exactly like EditorView does (apply the transaction, keep the new state).
 */
class FakeView {
    state: EditorState;
    dispatches = 0;

    constructor(doc: string, cursor = doc.length) {
        this.state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: snippetExtension });
    }

    dispatch(...specs: TransactionSpec[]) {
        this.dispatches++;
        this.state = this.state.update(...specs).state;
    }

    get view(): EditorView {
        return this as unknown as EditorView;
    }

    get doc(): string {
        return this.state.doc.toString();
    }

    get cursor(): number {
        return this.state.selection.main.head;
    }

    get selection(): { from: number; to: number } {
        const { from, to } = this.state.selection.main;
        return { from, to };
    }

    get selectedText(): string {
        const { from, to } = this.state.selection.main;
        return this.state.sliceDoc(from, to);
    }

    /** Like typing: replaces the selection and puts the cursor after the text. */
    type(text: string) {
        this.dispatch(this.state.replaceSelection(text), { userEvent: "input.type" });
    }

    backspace() {
        const head = this.cursor;
        this.dispatch({ changes: { from: head - 1, to: head }, selection: { anchor: head - 1 }, userEvent: "delete" });
    }

    moveTo(pos: number) {
        this.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select" });
    }

    insert(from: number, to: number, snippet: string, syntax?: "latex" | "template") {
        insertSnippet(this.view, from, to, snippet, syntax);
    }

    /** Replaces the word in front of the cursor with the snippet, like accepting a suggestion. */
    complete(word: string, snippet: string, syntax?: "latex" | "template") {
        this.insert(this.cursor - word.length, this.cursor, snippet, syntax);
    }

    jump() {
        jumpToNextPlaceholder(this.view);
    }

    /** The highlighted placeholders: [from, to, class] for marks, [pos, pos, "empty-<color>"] for empty ones. */
    get highlights(): [number, number, string][] {
        const result: [number, number, string][] = [];
        for (const value of this.state.facet(EditorView.decorations)) {
            if (typeof value === "function") continue;
            for (let it = value.iter(); it.value; it.next()) {
                const spec = it.value.spec as { class?: string; widget?: { color: number } };
                const cls = spec.class ?? `empty-${spec.widget?.color}`;
                result.push([it.from, it.to, cls.replace("completr-placeholder ", "")]);
            }
        }
        return result;
    }
}

describe("parseSnippet (latex syntax)", () => {
    test("removes placeholders and records their positions", () => {
        expect(parseSnippet("\\frac{#}{#}")).toEqual({
            text: "\\frac{}{}",
            placeholders: [6, 8],
            placeholderRanges: [
                [6, 6],
                [8, 8],
            ],
            finalCursor: null,
        });
    });

    test("final cursor", () => {
        expect(parseSnippet("\\begin{x}\n~\n\\end{x}")).toEqual({
            text: "\\begin{x}\n\n\\end{x}",
            placeholders: [],
            placeholderRanges: [],
            finalCursor: 10,
        });
    });

    test("only the first ~ counts, later ones are removed", () => {
        expect(parseSnippet("a~b~c")).toMatchObject({ text: "abc", finalCursor: 1 });
    });

    test("no markers", () => {
        expect(parseSnippet("\\alpha")).toEqual({
            text: "\\alpha",
            placeholders: [],
            placeholderRanges: [],
            finalCursor: null,
        });
        expect(parseSnippet("")).toMatchObject({ text: "", finalCursor: null });
    });

    test("continuation prefix after each line break, offsets include it", () => {
        expect(parseSnippet("\\begin{x}\n~\n\\end{x}", "> ")).toMatchObject({
            text: "\\begin{x}\n> \n> \\end{x}",
            finalCursor: 12,
        });
        expect(parseSnippet("a\n#", "  ")).toMatchObject({ text: "a\n  ", placeholders: [4] });
    });

    test("{{ }} has no special meaning", () => {
        expect(parseSnippet("{{a}}")).toMatchObject({ text: "{{a}}", placeholders: [] });
    });

    test("characters outside the BMP", () => {
        expect(parseSnippet("😀#")).toMatchObject({ text: "😀", placeholders: [2] });
    });
});

describe("parseSnippet (template syntax)", () => {
    test("empty placeholders", () => {
        expect(parseSnippet("a{{}}b{{}}", "", "template")).toMatchObject({
            text: "ab",
            placeholders: [1, 2],
            placeholderRanges: [
                [1, 1],
                [2, 2],
            ],
        });
    });

    test("pre-filled placeholders", () => {
        expect(parseSnippet("Hello {{name}}!", "", "template")).toEqual({
            text: "Hello name!",
            placeholders: [6],
            placeholderRanges: [[6, 10]],
            finalCursor: null,
        });
    });

    test("{{cursor}} is the final cursor position", () => {
        expect(parseSnippet("- [ ] {{cursor}}", "", "template")).toMatchObject({ text: "- [ ] ", finalCursor: 6 });
        expect(parseSnippet("{{cursor}}a{{cursor}}", "", "template")).toMatchObject({ text: "a", finalCursor: 0 });
    });

    test("# and ~ are plain text", () => {
        expect(parseSnippet("# Title ~~strike~~", "", "template")).toMatchObject({
            text: "# Title ~~strike~~",
            placeholders: [],
            finalCursor: null,
        });
    });

    test("unclosed braces are plain text", () => {
        expect(parseSnippet("{{open", "", "template")).toMatchObject({ text: "{{open", placeholders: [] });
        expect(parseSnippet("{a}", "", "template")).toMatchObject({ text: "{a}", placeholders: [] });
    });

    test("multi-line pre-filled placeholder includes the continuation prefix", () => {
        expect(parseSnippet("{{a\nb}}\n{{cursor}}", "> ", "template")).toEqual({
            text: "a\n> b\n> ",
            placeholders: [0],
            placeholderRanges: [[0, 5]],
            finalCursor: 8,
        });
    });
});

describe("snippet state", () => {
    test("inserting selects the first placeholder", () => {
        const v = new FakeView("x \\fr");
        v.complete("\\fr", "\\frac{#}{#}");
        expect(v.doc).toBe("x \\frac{}{}");
        expect(v.selection).toEqual({ from: 8, to: 8 });
        expect(isInPlaceholder(v.state)).toBe(true);
        expect(hasActiveSnippet(v.state)).toBe(true);
    });

    test("snippets without placeholders just insert the text", () => {
        const v = new FakeView("\\al");
        v.complete("\\al", "\\alpha");
        expect(v.doc).toBe("\\alpha");
        expect(v.cursor).toBe(6);
        expect(hasActiveSnippet(v.state)).toBe(false);
        expect(isInPlaceholder(v.state)).toBe(false);
    });

    test("snippets with only a final cursor put the cursor there without an active snippet", () => {
        const v = new FakeView("\\begin");
        v.complete("\\begin", "\\begin{align}\n~\n\\end{align}");
        expect(v.doc).toBe("\\begin{align}\n\n\\end{align}");
        expect(v.cursor).toBe(14);
        expect(hasActiveSnippet(v.state)).toBe(false);
    });

    test("placeholders grow while typing into them", () => {
        const v = new FakeView("\\fr");
        v.complete("\\fr", "\\frac{#}{#}");
        v.type("a");
        v.type("bc");
        expect(v.doc).toBe("\\frac{abc}{}");
        expect(isInPlaceholder(v.state)).toBe(true);
        expect(v.highlights).toEqual([
            [6, 9, "completr-placeholder-0"],
            [11, 11, "empty-0"],
        ]);
    });

    test("placeholders shrink when deleting inside them", () => {
        const v = new FakeView("\\fr");
        v.complete("\\fr", "\\frac{#}{#}");
        v.type("ab");
        v.backspace();
        v.backspace();
        expect(v.doc).toBe("\\frac{}{}");
        expect(isInPlaceholder(v.state)).toBe(true);
        expect(v.highlights).toEqual([
            [6, 6, "empty-0"],
            [8, 8, "empty-0"],
        ]);
    });

    test("jumpToNextPlaceholder visits the placeholders in order", () => {
        const v = new FakeView("\\int");
        v.complete("\\int", "\\int_{#}^{#} #");
        v.type("0");
        v.jump();
        expect(v.cursor).toBe(10);
        v.type("1");
        v.jump();
        expect(v.cursor).toBe(13);
        v.type("x");
        expect(v.doc).toBe("\\int_{0}^{1} x");
    });

    test("later placeholders move with text typed into earlier ones", () => {
        const v = new FakeView("\\fr");
        v.complete("\\fr", "\\frac{#}{#}");
        v.type("long numerator");
        v.jump();
        expect(v.cursor).toBe("\\frac{long numerator}{".length);
    });

    test("jumping selects a non-empty placeholder", () => {
        const v = new FakeView("");
        v.insert(0, 0, "{{first}} and {{second}}", "template");
        expect(v.selectedText).toBe("first");
        v.jump();
        expect(v.selectedText).toBe("second");
    });

    test("typing replaces a selected pre-filled placeholder and keeps tracking it", () => {
        const v = new FakeView("");
        v.insert(0, 0, "Dear {{name}}, {{text}}", "template");
        v.type("Tim");
        expect(v.doc).toBe("Dear Tim, text");
        expect(isInPlaceholder(v.state)).toBe(true);
        v.type("my");
        expect(v.highlights[0]).toEqual([5, 10, "completr-placeholder-0"]);
        v.jump();
        expect(v.selectedText).toBe("text");
    });

    test("after the last placeholder the cursor jumps to the final position", () => {
        const v = new FakeView("");
        v.insert(0, 0, "f(#, #)~ rest");
        v.jump();
        v.jump();
        expect(v.cursor).toBe(5);
        expect(v.doc).toBe("f(, ) rest");
        expect(hasActiveSnippet(v.state)).toBe(false);
        expect(isInPlaceholder(v.state)).toBe(false);
    });

    test("the final position moves with typed text and is not highlighted", () => {
        const v = new FakeView("");
        v.insert(0, 0, "(#) ~");
        expect(v.highlights).toEqual([[1, 1, "empty-0"]]);
        v.type("abc");
        v.jump();
        expect(v.cursor).toBe(6);
        expect(v.doc).toBe("(abc) ");
    });

    test("{{cursor}} is the final position in template syntax", () => {
        const v = new FakeView("");
        v.insert(0, 0, "**{{bold}}** {{cursor}}", "template");
        v.type("x");
        v.jump();
        expect(v.cursor).toBe(6);
        expect(hasActiveSnippet(v.state)).toBe(false);
    });

    describe("closing bracket skip", () => {
        test.each([
            ["\\sqrt{#}", "x", 8],
            ["f(#)", "x", 4],
            ["a[#]", "x", 4],
        ])("jumping out of the last placeholder of %p skips the closing bracket", (snippet, typed, expected) => {
            const v = new FakeView("");
            v.insert(0, 0, snippet);
            v.type(typed);
            v.jump();
            expect(v.cursor).toBe(expected);
            expect(hasActiveSnippet(v.state)).toBe(false);
        });

        test("other characters are not skipped", () => {
            const v = new FakeView("");
            v.insert(0, 0, "#,x");
            v.type("a");
            v.jump();
            expect(v.cursor).toBe(1);
            expect(hasActiveSnippet(v.state)).toBe(false);
        });

        test("at the end of the document", () => {
            const v = new FakeView("");
            v.insert(0, 0, "x#");
            v.jump();
            expect(v.cursor).toBe(1);
        });

        test("only one bracket is skipped", () => {
            const v = new FakeView("");
            v.insert(0, 0, "((#))");
            v.jump();
            expect(v.cursor).toBe(3);
        });
    });

    test("moving the cursor away ends the snippet", () => {
        const v = new FakeView("text ");
        v.complete("", "\\frac{#}{#}");
        v.moveTo(0);
        expect(hasActiveSnippet(v.state)).toBe(false);
        expect(isInPlaceholder(v.state)).toBe(false);
        expect(v.highlights).toEqual([]);
        // Jumping does nothing now
        const before = v.dispatches;
        v.jump();
        expect(v.dispatches).toBe(before);
    });

    test("moving the cursor within a placeholder keeps the snippet", () => {
        const v = new FakeView("");
        v.insert(0, 0, "\\frac{#}{#}");
        v.type("abc");
        v.moveTo(7);
        expect(isInPlaceholder(v.state)).toBe(true);
        v.jump();
        expect(v.cursor).toBe(11);
    });

    test("moving the cursor into a later placeholder keeps the snippet, but it is not the current one", () => {
        const v = new FakeView("");
        v.insert(0, 0, "\\frac{#}{#}");
        v.moveTo(8);
        expect(hasActiveSnippet(v.state)).toBe(true);
        expect(isInPlaceholder(v.state)).toBe(false);
    });

    test("edits elsewhere move the placeholders", () => {
        const v = new FakeView("");
        v.insert(0, 0, "\\frac{#}{#}");
        v.dispatch({ changes: { from: 0, insert: "$" } });
        expect(v.cursor).toBe(7);
        expect(isInPlaceholder(v.state)).toBe(true);
        v.jump();
        expect(v.cursor).toBe(9);
    });

    test("multi-line snippets continue block quotes and lists", () => {
        const v = new FakeView("> - \\begin");
        v.complete("\\begin", "\\begin{align}\n~\n\\end{align}");
        expect(v.doc).toBe("> - \\begin{align}\n>   \n>   \\end{align}");
        expect(v.state.doc.lineAt(v.cursor).text).toBe(">   ");
        expect(v.cursor).toBe(v.state.doc.line(2).to);
    });

    test("works without the snippet extension (nothing is tracked)", () => {
        const view = {
            state: EditorState.create({ doc: "" }),
            dispatch(spec: TransactionSpec) {
                this.state = this.state.update(spec).state;
            },
        };
        insertSnippet(view as unknown as EditorView, 0, 0, "\\frac{#}{#}");
        expect(view.state.doc.toString()).toBe("\\frac{}{}");
        expect(hasActiveSnippet(view.state)).toBe(false);
        expect(isInPlaceholder(view.state)).toBe(false);
    });

    describe("nested snippets", () => {
        test("a snippet inserted into a placeholder gets its own color and is visited first", () => {
            const v = new FakeView("");
            v.insert(0, 0, "\\frac{#}{#}");
            v.type("\\sq");
            v.complete("\\sq", "\\sqrt{#}");
            expect(v.doc).toBe("\\frac{\\sqrt{}}{}");
            expect(v.cursor).toBe(12);
            const colors = v.highlights.map((h) => h[2]);
            expect(colors).toContain("empty-1");
            expect(colors).toContain("empty-0");
            v.type("x");
            expect(v.doc).toBe("\\frac{\\sqrt{x}}{}");
        });

        test("leaving the inner snippet continues with the outer snippet's next placeholder", () => {
            const v = new FakeView("");
            v.insert(0, 0, "\\frac{#}{#}");
            v.complete("", "\\sqrt{#}");
            v.type("x");
            v.jump();
            expect(v.selectedText).toBe("");
            v.type("y");
            expect(v.doc).toContain("\\sqrt{x}");
        });

        test("finishing an inner snippet with a final position keeps the outer snippet", () => {
            const v = new FakeView("");
            v.insert(0, 0, "\\frac{#}{#}");
            v.complete("", "\\sqrt{#}~");
            v.type("x");
            v.jump(); // to the inner final position
            expect(v.cursor).toBe("\\frac{\\sqrt{x}".length);
            expect(hasActiveSnippet(v.state)).toBe(true);
            v.jump();
            expect(v.cursor).toBe("\\frac{\\sqrt{x}}{".length);
        });
    });

    describe("adjacent placeholders", () => {
        test("text typed into the first placeholder does not end up in the second", () => {
            const v = new FakeView("");
            v.insert(0, 0, "##");
            v.type("ab");
            v.jump();
            expect(v.selection).toEqual({ from: 2, to: 2 });
            v.type("c");
            expect(v.doc).toBe("abc");
        });
    });
});
