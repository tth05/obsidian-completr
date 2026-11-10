import { describe, expect, test } from "bun:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type Suggestion, type SuggestionProvider, suggestion } from "../../src/provider/provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { snippetExtension } from "../../src/snippets.ts";
import {
    computeSuggestions,
    insertSuggestion,
    MAX_SUGGESTIONS,
    type SuggestionSources,
} from "../../src/suggestions.ts";
import { makeContext, makeSettings } from "./helpers.ts";

function provider(id: string, result: Suggestion[], blocksAllOtherProviders = false): SuggestionProvider {
    return { id, icon: id, blocksAllOtherProviders, getSuggestions: () => result.map((s) => ({ ...s })) };
}

function sources(
    providers: SuggestionProvider[],
    opts: { blacklist?: string[]; usage?: Record<string, number>; settings?: Partial<CompletrSettings> } = {},
) {
    const recorded: string[] = [];
    const sources: SuggestionSources = {
        settings: makeSettings(opts.settings),
        providers,
        blacklist: { has: (name) => opts.blacklist?.includes(name) ?? false },
        usage: { get: (name) => opts.usage?.[name] ?? 0, record: (name) => void recorded.push(name) },
    };
    return { sources, recorded };
}

const names = (list: Suggestion[]) => list.map((s) => s.displayName);

describe("computeSuggestions", () => {
    test("keeps the providers' order and remembers where each suggestion came from", () => {
        const a = provider("a", [suggestion("one"), suggestion("two")]);
        const b = provider("b", [suggestion("three")]);
        const { suggestions, start } = computeSuggestions(sources([a, b]).sources, makeContext("t"));
        expect(names(suggestions)).toEqual(["one", "two", "three"]);
        expect(suggestions.map((s) => s.provider?.id)).toEqual(["a", "a", "b"]);
        expect(start).toBeNull();
    });

    test("removes duplicates (the first one wins) and blacklisted suggestions", () => {
        const a = provider("a", [suggestion("one"), suggestion("hidden")]);
        const b = provider("b", [suggestion("one", "other"), suggestion("two")]);
        const { suggestions } = computeSuggestions(sources([a, b], { blacklist: ["hidden"] }).sources, makeContext(""));
        expect(names(suggestions)).toEqual(["one", "two"]);
        expect(suggestions[0].provider?.id).toBe("a");
    });

    test("fuzzy matches come last, frequently used suggestions first within their group", () => {
        const a = provider("a", [suggestion("fuzzyA", "fuzzyA", { isFuzzy: true }), suggestion("rare")]);
        const b = provider("b", [suggestion("fuzzyB", "fuzzyB", { isFuzzy: true }), suggestion("often")]);
        const usage = { often: 5, fuzzyB: 1 };
        expect(names(computeSuggestions(sources([a, b], { usage }).sources, makeContext("")).suggestions)).toEqual([
            "often",
            "rare",
            "fuzzyB",
            "fuzzyA",
        ]);
        const unranked = sources([a, b], { usage, settings: { rankByUsage: false } }).sources;
        expect(names(computeSuggestions(unranked, makeContext("")).suggestions)).toEqual([
            "rare",
            "often",
            "fuzzyA",
            "fuzzyB",
        ]);
    });

    test("a provider that blocks all others replaces their suggestions and tells where the replacement starts", () => {
        const start = { line: 0, ch: 2 };
        const blocking = provider("callout", [suggestion("note", "[!note]", { overrideStart: start })], true);
        const later = provider("words", [suggestion("never")]);
        const result = computeSuggestions(sources([blocking, later]).sources, makeContext(""));
        expect(names(result.suggestions)).toEqual(["note"]);
        expect(result.start).toEqual(start);
    });

    test("is limited to MAX_SUGGESTIONS", () => {
        const many = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => suggestion("word" + i));
        expect(computeSuggestions(sources([provider("a", many)]).sources, makeContext("")).suggestions).toHaveLength(
            MAX_SUGGESTIONS,
        );
    });
});

describe("insertSuggestion", () => {
    /** Applies dispatched transactions like EditorView does. */
    class FakeView {
        state: EditorState;
        constructor(doc: string) {
            this.state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: snippetExtension });
        }
        dispatch(spec: TransactionSpec) {
            this.state = this.state.update(spec).state;
        }
        get view() {
            return this as unknown as EditorView;
        }
        get textWithCursor() {
            const doc = this.state.doc.toString();
            const head = this.state.selection.main.head;
            return doc.slice(0, head) + "|" + doc.slice(head);
        }
    }

    test("replaces the range, puts the cursor after it and records the usage", () => {
        const { sources: s, recorded } = sources([]);
        const editor = new FakeView("Some xyl");
        insertSuggestion(s, editor.view, suggestion("xylophone"), 5, 8);
        expect(editor.textWithCursor).toBe("Some xylophone|");
        expect(recorded).toEqual(["xylophone"]);
    });

    test("appendSpace adds a space unless there already is whitespace", () => {
        const { sources: s } = sources([], { settings: { rankByUsage: false } });
        const editor = new FakeView("xyl");
        insertSuggestion(s, editor.view, suggestion("xylem", "xylem", { appendSpace: true }), 0, 3);
        expect(editor.textWithCursor).toBe("xylem |");

        const before = new FakeView("xyl more");
        insertSuggestion(s, before.view, suggestion("xylem", "xylem", { appendSpace: true }), 0, 3);
        expect(before.state.doc.toString()).toBe("xylem more");
    });

    test("snippets get their placeholders", () => {
        const { sources: s, recorded } = sources([], { settings: { rankByUsage: false } });
        const editor = new FakeView("$\\fr");
        insertSuggestion(s, editor.view, suggestion("\\frac{#}{#}", "frac{#}{#}", { snippet: "latex" }), 2, 4);
        expect(editor.textWithCursor).toBe("$\\frac{|}{}");
        expect(recorded).toEqual([]);
    });
});
