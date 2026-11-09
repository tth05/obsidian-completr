import {
    EditorSelection,
    type EditorState,
    type Extension,
    StateEffect,
    StateField,
    type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { getContinuationPrefix } from "./text.ts";

/**
 * Snippets are suggestions with placeholders: "#" marks a placeholder, "~" the final cursor position. Placeholders are
 * not inserted as text. They are tracked as ranges that grow while typing into them, so the inserted text stays valid
 * (e.g. `\frac{}{}` instead of `\frac{#}{#}` which breaks the math preview).
 */

export const COLOR_COUNT = 7;

interface Placeholder {
    from: number;
    to: number;
    /** Index into the placeholder colors. Each inserted snippet gets its own color. */
    color: number;
    /** The final cursor position ("~"). It is jumped to last and not highlighted. */
    isFinal: boolean;
}

/** The placeholders in the order they are visited. The first one is the current one. */
type SnippetState = readonly Placeholder[];

/**
 * - "latex": "#" marks an empty placeholder, "~" the final cursor position (used by LaTeX commands, where these
 *   characters are rare).
 * - "template": "{{}}" marks an empty placeholder, "{{text}}" a placeholder pre-filled with "text", "{{cursor}}" the
 *   final cursor position (used by snippets, where "#" and "~" are common markdown).
 */
export type SnippetSyntax = "latex" | "template";

export interface ParsedSnippet {
    text: string;
    /** Start offsets of the placeholders in {@link text}. */
    placeholders: number[];
    /** [start, end) of the placeholders in {@link text}. Only differs from {@link placeholders} for pre-filled ones. */
    placeholderRanges: [number, number][];
    finalCursor: number | null;
}

/**
 * Removes the placeholder markers from a snippet, recording their positions.
 * @param continuationPrefix inserted after each line break, so multi-line snippets keep indentation / quote markers.
 */
export function parseSnippet(snippet: string, continuationPrefix = "", syntax: SnippetSyntax = "latex"): ParsedSnippet {
    let text = "";
    const ranges: [number, number][] = [];
    let finalCursor: number | null = null;
    const append = (s: string) => (text += s.replaceAll("\n", "\n" + continuationPrefix));

    for (let i = 0; i < snippet.length; i++) {
        const c = snippet[i];
        if (syntax === "latex") {
            if (c === "#") ranges.push([text.length, text.length]);
            else if (c === "~") finalCursor ??= text.length;
            else append(c);
            continue;
        }

        const end = c === "{" && snippet[i + 1] === "{" ? snippet.indexOf("}}", i + 2) : -1;
        if (end === -1) {
            append(c);
            continue;
        }
        const inner = snippet.substring(i + 2, end);
        if (inner === "cursor") {
            finalCursor ??= text.length;
        } else {
            const start = text.length;
            append(inner);
            ranges.push([start, text.length]);
        }
        i = end + 1;
    }
    return { text, placeholders: ranges.map((r) => r[0]), placeholderRanges: ranges, finalCursor };
}

const addSnippet = StateEffect.define<Placeholder[]>();
const removeCurrent = StateEffect.define<null>();
const clearAll = StateEffect.define<null>();

function mapPlaceholders(placeholders: SnippetState, tr: Transaction): SnippetState {
    if (!tr.docChanged) return placeholders;
    return placeholders.map((p) => {
        // Text typed at either edge belongs to the placeholder
        const from = tr.changes.mapPos(p.from, -1);
        const to = Math.max(from, tr.changes.mapPos(p.to, 1));
        return { ...p, from, to };
    });
}

function contains(p: Placeholder, pos: number): boolean {
    return pos >= p.from && pos <= p.to;
}

const snippetField = StateField.define<SnippetState>({
    create: () => [],
    update(value, tr) {
        let result = mapPlaceholders(value, tr);
        for (const effect of tr.effects) {
            if (effect.is(addSnippet)) result = [...effect.value, ...result];
            else if (effect.is(removeCurrent)) result = result.slice(1);
            else if (effect.is(clearAll)) result = [];
        }

        // Moving the cursor away from all placeholders ends the snippet
        if (result.length > 0 && tr.selection && !tr.effects.some((e) => e.is(addSnippet))) {
            const head = tr.selection.main.head;
            if (!result.some((p) => contains(p, head))) result = [];
        }
        return result;
    },
    provide: (field) => EditorView.decorations.from(field, buildDecorations),
});

class EmptyPlaceholderWidget extends WidgetType {
    constructor(private readonly color: number) {
        super();
    }

    override eq(other: EmptyPlaceholderWidget): boolean {
        return other.color === this.color;
    }

    toDOM(): HTMLElement {
        const el = document.createElement("span");
        el.className = `completr-placeholder completr-placeholder-empty completr-placeholder-${this.color}`;
        return el;
    }

    override ignoreEvent(): boolean {
        return false;
    }
}

function buildDecorations(placeholders: SnippetState): DecorationSet {
    const ranges = placeholders
        .filter((p) => !p.isFinal)
        .map((p) =>
            p.from === p.to
                ? Decoration.widget({ widget: new EmptyPlaceholderWidget(p.color), side: 1 }).range(p.from)
                : Decoration.mark({ class: `completr-placeholder completr-placeholder-${p.color}` }).range(
                      p.from,
                      p.to,
                  ),
        );
    return Decoration.set(ranges, true);
}

export const snippetExtension: Extension = snippetField;

function getPlaceholders(state: EditorState): SnippetState {
    return state.field(snippetField, false) ?? [];
}

/** Whether the cursor is inside the current placeholder, i.e. "jump to next placeholder" is possible. */
export function isInPlaceholder(state: EditorState): boolean {
    const current = getPlaceholders(state)[0];
    return !!current && !current.isFinal && contains(current, state.selection.main.head);
}

export function hasActiveSnippet(state: EditorState): boolean {
    return getPlaceholders(state).length > 0;
}

/** Replaces `from`-`to` with the snippet and selects its first placeholder. */
export function insertSnippet(
    view: EditorView,
    from: number,
    to: number,
    snippet: string,
    syntax: SnippetSyntax = "latex",
) {
    const state = view.state;
    const line = state.doc.lineAt(from);
    const parsed = parseSnippet(snippet, getContinuationPrefix(line.text), syntax);

    const used = new Set(getPlaceholders(state).map((p) => p.color));
    let color = 0;
    while (used.has(color) && color < COLOR_COUNT - 1) color++;

    const placeholders: Placeholder[] = parsed.placeholderRanges.map(([start, end]) => ({
        from: from + start,
        to: from + end,
        color,
        isFinal: false,
    }));
    if (parsed.finalCursor !== null && placeholders.length > 0)
        placeholders.push({ from: from + parsed.finalCursor, to: from + parsed.finalCursor, color, isFinal: true });

    const first = placeholders[0];
    const cursor = from + (parsed.finalCursor ?? parsed.text.length);
    view.dispatch({
        changes: { from, to, insert: parsed.text },
        // A pre-filled placeholder is selected, so typing replaces it
        selection: first ? EditorSelection.range(first.from, first.to) : EditorSelection.cursor(cursor),
        effects: placeholders.length > 0 ? addSnippet.of(placeholders) : [],
        scrollIntoView: true,
    });
}

/**
 * Leaves the current placeholder and moves to the next one. Without a next placeholder, the cursor is moved behind the
 * closing bracket after the placeholder, if there is one.
 */
export function jumpToNextPlaceholder(view: EditorView) {
    const placeholders = getPlaceholders(view.state);
    const current = placeholders[0];
    if (!current) return;

    const next = placeholders[1];
    if (next) {
        view.dispatch({
            selection: EditorSelection.range(next.from, next.to),
            effects: next.isFinal ? clearAll.of(null) : removeCurrent.of(null),
            scrollIntoView: true,
        });
        return;
    }

    const after = view.state.doc.sliceString(current.to, current.to + 1);
    const target = /^[)\]}]$/.test(after) ? current.to + 1 : current.to;
    view.dispatch({ selection: EditorSelection.cursor(target), effects: clearAll.of(null), scrollIntoView: true });
}

export function clearSnippets(view: EditorView) {
    if (hasActiveSnippet(view.state)) view.dispatch({ effects: clearAll.of(null) });
}
