import { type EditorState, StateEffect, StateField, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getCursorContext, getLatexContext } from "./editor_context.ts";
import { isNoop } from "./typing.ts";

/*
 * "Period after double space", like phone keyboards: after a completed word got a space appended, pressing Space right
 * away turns "word " into "word. ". Inserting the word arms it at the cursor, anything else in between (typing, moving
 * the cursor, clicking, another key) disarms it. The Space key itself is handled in keybindings.ts.
 */

/** Arms it at a position (right after the appended space), or disarms it with null. */
export const armPeriod = StateEffect.define<number | null>();

export const periodField = StateField.define<number | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(armPeriod)) return effect.value;
        if (value === null) return null;
        // Obsidian sometimes replaces text with the same text, e.g. when it renders math for the first time
        if (tr.docChanged && !isNoop(tr)) return null;
        if (tr.isUserEvent("select")) return null;
        const pos = tr.changes.mapPos(value);
        const { selection } = tr.state;
        return selection.ranges.length === 1 && selection.main.empty && selection.main.head === pos ? pos : null;
    },
});

/**
 * The change that turns the appended space into ". ", null if it isn't armed or doesn't apply here. One undo step:
 * "input.complete" isn't joined with the insertion of the word in the undo history, unlike "input.type".
 */
export function periodChange(state: EditorState): TransactionSpec | null {
    const pos = state.field(periodField, false);
    if (pos == null || state.doc.sliceString(pos - 1, pos) !== " ") return null;
    // Not in code or math, where ". " would be wrong
    const context = getCursorContext(state, pos);
    if (context.inCode || getLatexContext(state, pos, false, context)) return null;
    return {
        changes: { from: pos - 1, to: pos, insert: ". " },
        selection: { anchor: pos + 1 },
        effects: armPeriod.of(null),
        userEvent: "input.complete",
        scrollIntoView: true,
    };
}

/** Whether vim is in normal (or visual) mode, where Space doesn't type. */
function isVimNormalMode(view: EditorView): boolean {
    // Obsidian's vim mode: the CodeMirror 5 adapter keeps the vim state
    const vim = (view as EditorView & { cm?: { state?: { vim?: { insertMode?: boolean } } } }).cm?.state?.vim;
    return !!vim && !vim.insertMode;
}

/** Handles Space: applies {@link periodChange}. Returns false if it doesn't apply, Space then types a space. */
export function insertPeriod(view: EditorView): boolean {
    if (isVimNormalMode(view)) return false;
    const change = periodChange(view.state);
    if (!change) return false;
    view.dispatch(change);
    return true;
}

/** Disarms it, e.g. when another key is pressed. */
export function disarmPeriod(view: EditorView) {
    if (view.state.field(periodField, false) != null) view.dispatch({ effects: armPeriod.of(null) });
}
