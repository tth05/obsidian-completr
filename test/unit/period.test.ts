import { describe, expect, test } from "bun:test";
import { EditorState, StateEffect, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { armPeriod, periodChange, periodField } from "../../src/period.ts";
import { suggestion } from "../../src/provider/provider.ts";
import { snippetExtension } from "../../src/snippets.ts";
import { insertSuggestion, type SuggestionSources } from "../../src/suggestions.ts";
import { makeSettings } from "./helpers.ts";

/** Applies dispatched transactions like EditorView does. `|` marks the cursor. */
class FakeView {
    state: EditorState;
    constructor(text: string) {
        const cursor = text.indexOf("|");
        this.state = EditorState.create({
            doc: text.replace("|", ""),
            selection: { anchor: cursor },
            extensions: [snippetExtension, periodField],
        });
    }
    dispatch(spec: TransactionSpec) {
        this.state = this.state.update(spec).state;
    }
    get view() {
        return this as unknown as EditorView;
    }
    get armed() {
        return this.state.field(periodField);
    }
    get textWithCursor() {
        const doc = this.state.doc.toString();
        const head = this.state.selection.main.head;
        return doc.slice(0, head) + "|" + doc.slice(head);
    }
}

function sources(insertPeriodAfterSpace = true): SuggestionSources {
    return {
        settings: makeSettings({ insertPeriodAfterSpace, rankByUsage: false }),
        providers: [],
        blacklist: { has: () => false },
        usage: { get: () => 0, record: () => {} },
    };
}

/** "Some xyl" with "xylem" completed and a space appended: armed after "xylem ". */
function completed(text = "Some xyl|", settingOn = true) {
    const editor = new FakeView(text);
    insertSuggestion(sources(settingOn), editor.view, suggestion("xylem", "xylem", { appendSpace: true }), 5, 8);
    return editor;
}

describe("arming", () => {
    test("is off by default", () => {
        expect(makeSettings().insertPeriodAfterSpace).toBe(false);
    });

    test("inserting a word with an appended space arms it at the cursor", () => {
        const editor = completed();
        expect(editor.textWithCursor).toBe("Some xylem |");
        expect(editor.armed).toBe(11);
    });

    test("not without the setting", () => {
        expect(completed("Some xyl|", false).armed).toBeNull();
    });

    test("not if no space was appended", () => {
        // Whitespace after the word already
        const before = completed("Some xyl| more");
        expect(before.textWithCursor).toBe("Some xylem| more");
        expect(before.armed).toBeNull();

        const editor = new FakeView("Some xyl|");
        insertSuggestion(sources(), editor.view, suggestion("xylem"), 5, 8);
        expect(editor.armed).toBeNull();
    });

    test("not after a snippet", () => {
        const editor = new FakeView("$\\fr|");
        insertSuggestion(sources(), editor.view, suggestion("\\frac{#}{#}", "frac{#}{#}", { snippet: "latex" }), 2, 4);
        expect(editor.textWithCursor).toBe("$\\frac{|}{}");
        expect(editor.armed).toBeNull();
    });
});

describe("disarming", () => {
    test("typing a character", () => {
        const editor = completed();
        editor.dispatch({ changes: { from: 11, insert: "a" }, selection: { anchor: 12 }, userEvent: "input.type" });
        expect(editor.armed).toBeNull();
    });

    test("deleting", () => {
        const editor = completed();
        editor.dispatch({ changes: { from: 10, to: 11 }, userEvent: "delete.backward" });
        expect(editor.armed).toBeNull();
    });

    test("moving the cursor, also there and back", () => {
        const editor = completed();
        editor.dispatch({ selection: { anchor: 10 }, userEvent: "select" });
        expect(editor.armed).toBeNull();

        const moved = completed();
        moved.dispatch({ selection: { anchor: 10 } });
        moved.dispatch({ selection: { anchor: 11 } });
        expect(moved.armed).toBeNull();
    });

    test("a click, even at the cursor", () => {
        const editor = completed();
        editor.dispatch({ selection: { anchor: 11 }, userEvent: "select.pointer" });
        expect(editor.armed).toBeNull();
    });

    test("a selection", () => {
        const editor = completed();
        editor.dispatch({ selection: { anchor: 11, head: 5 } });
        expect(editor.armed).toBeNull();
    });

    test("explicitly", () => {
        const editor = completed();
        editor.dispatch({ effects: armPeriod.of(null) });
        expect(editor.armed).toBeNull();
    });
});

describe("staying armed", () => {
    test("transactions that change neither the text nor the cursor (e.g. the inline suggestion)", () => {
        const editor = completed();
        editor.dispatch({ effects: StateEffect.define<number>().of(1) });
        expect(editor.armed).toBe(11);
    });

    test("Obsidian replacing text with the same text", () => {
        const editor = completed();
        editor.dispatch({ changes: { from: 0, to: 4, insert: "Some" } });
        expect(editor.armed).toBe(11);
    });
});

describe("periodChange", () => {
    test("replaces the appended space with '. ' in one change, the cursor after it", () => {
        const editor = completed();
        const change = periodChange(editor.state)!;
        expect(change).not.toBeNull();
        const tr = editor.state.update(change);
        expect(tr.isUserEvent("input.type")).toBe(false);
        editor.dispatch(change);
        expect(editor.textWithCursor).toBe("Some xylem. |");
        expect(editor.armed).toBeNull();
        // Only once
        expect(periodChange(editor.state)).toBeNull();
    });

    test("nothing if not armed", () => {
        expect(periodChange(new FakeView("Some xylem |").state)).toBeNull();
        expect(periodChange(completed("Some xyl|", false).state)).toBeNull();
        // Without the field
        expect(periodChange(EditorState.create({ doc: "xylem " }))).toBeNull();
    });

    test("nothing if the character in front isn't a space", () => {
        const editor = new FakeView("Some xylem|");
        editor.dispatch({ effects: armPeriod.of(10) });
        expect(editor.armed).toBe(10);
        expect(periodChange(editor.state)).toBeNull();
    });
});
