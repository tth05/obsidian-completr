import { type Extension, StateEffect, StateField, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, type PluginValue, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type EditorPosition, editorInfoField } from "obsidian";
import type CompletrPlugin from "./main.ts";
import type { Suggestion } from "./provider/provider.ts";
import { parseSnippet } from "./snippets.ts";
import { computeSuggestions, createSuggestionContext, getWordBeforeCursor, insertSuggestion } from "./suggestions.ts";
import { isWordChar } from "./text.ts";
import { isNoop, isTyping, wasTyping } from "./typing.ts";

/*
 * Inline suggestions ("ghost text"): the rest of a suggestion is shown in grey after the cursor, Tab inserts it.
 *
 * Each editor keeps its inline suggestion in a state field. A view plugin decides what to show, always after the
 * update that caused it (in a microtask, so before the next paint):
 * - While Completr's popup is open, the inline suggestion is the popup's selected item. The popup reports every change
 *   of its selection (a new list selects the first item, the arrow keys and the mouse move it).
 * - If the popup opens automatically, it computes the suggestions after every typed character anyway, and opens if
 *   there are any. Nothing is computed twice: the popup's list decides.
 * - Otherwise, the suggestions are computed after every typed character, with the rules of the automatic popup.
 * Anything else (moving the cursor, deleting, pasting, Escape, losing focus) hides it until the next typed character.
 */

export interface InlineSuggestion {
    suggestion: Suggestion;
    /** Where inserting the suggestion starts: the start of the typed word or the suggestion's `overrideStart`. */
    from: number;
    /** The cursor: where the text is shown and where inserting the suggestion ends. */
    pos: number;
    /** The rest of the suggestion, shown after the cursor. */
    text: string;
}

function toOffset(doc: Text, pos: EditorPosition): number {
    const line = doc.line(Math.min(Math.max(pos.line + 1, 1), doc.lines));
    return line.from + Math.min(Math.max(pos.ch, 0), line.length);
}

/** The text a suggestion puts into the document. Snippets lose their placeholder markers, pre-filled text stays. */
export function getInsertedText(s: Suggestion): string {
    return s.snippet ? parseSnippet(s.replacement, "", s.snippet).text : s.replacement;
}

/**
 * The inline suggestion for `s`, null if it can't be shown honestly: inserting it must keep the text that was typed
 * (from where it starts up to the cursor, exactly), end at the cursor, and only add text to the cursor's line.
 * @param queryStart start of the typed word, where suggestions without `overrideStart` start
 */
export function getInlineSuggestion(
    s: Suggestion,
    doc: Text,
    cursor: number,
    queryStart: number,
): InlineSuggestion | null {
    const from = s.overrideStart ? toOffset(doc, s.overrideStart) : queryStart;
    if (from > cursor) return null;
    if (s.overrideEnd && toOffset(doc, s.overrideEnd) !== cursor) return null;

    const inserted = getInsertedText(s);
    const typed = doc.sliceString(from, cursor);
    if (!inserted.startsWith(typed)) return null;
    const text = inserted.substring(typed.length);
    if (text.length === 0 || text.includes("\n")) return null;
    return { suggestion: s, from, pos: cursor, text };
}

/** The inline suggestion for the first suggestion that can be shown. */
export function findInlineSuggestion(
    suggestions: Iterable<Suggestion>,
    doc: Text,
    cursor: number,
    queryStart: number,
): InlineSuggestion | null {
    for (const s of suggestions) {
        const inline = getInlineSuggestion(s, doc, cursor, queryStart);
        if (inline) return inline;
    }
    return null;
}

/** Whether a word character follows `pos`. Inline suggestions are only shown at the end of a word. */
export function isBeforeWordChar(doc: Text, pos: number, characterRegex: string): boolean {
    const code = doc.sliceString(pos, pos + 2).codePointAt(0);
    return code !== undefined && isWordChar(String.fromCodePoint(code), characterRegex);
}

export const setInlineSuggestion = StateEffect.define<InlineSuggestion | null>();

/**
 * Typing the next characters of the inline suggestion keeps the rest of it until it is computed again. Without this,
 * it would flicker while the popup is open: the popup updates its list a moment after each keystroke.
 */
function continueTyping(value: InlineSuggestion, tr: Transaction): InlineSuggestion | null {
    if (!isTyping(tr)) return null;
    let typed = "";
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (fromA === value.pos && toA === value.pos) typed = inserted.toString();
    });
    const pos = value.pos + typed.length;
    if (!typed || typed.length >= value.text.length || !value.text.startsWith(typed)) return null;
    if (tr.state.selection.main.head !== pos) return null;
    return { ...value, pos, text: value.text.substring(typed.length) };
}

const FONT_PROPERTIES = ["font-family", "font-size", "font-weight", "font-style", "letter-spacing"];

/**
 * Gives the inline suggestion the font of the text in front of it. Highlighted text (bold, code, math, ...) is a span
 * that ends at the cursor, the inline suggestion is next to it and would otherwise get the font of the line.
 */
function matchFontOfTextBefore(el: HTMLElement) {
    let node = el.previousSibling;
    // CodeMirror puts empty images next to widgets to position the cursor
    while (node instanceof HTMLElement && node.classList.contains("cm-widgetBuffer")) node = node.previousSibling;
    while (node?.lastChild) node = node.lastChild;
    const source = node instanceof HTMLElement ? node : node?.parentElement;
    const view = el.ownerDocument.defaultView;
    if (!source || !view || source === el.parentElement || !el.isConnected) return;

    const style = view.getComputedStyle(source);
    for (const property of FONT_PROPERTIES) el.style.setProperty(property, style.getPropertyValue(property));
}

class InlineSuggestionWidget extends WidgetType {
    constructor(readonly text: string) {
        super();
    }

    override eq(other: InlineSuggestionWidget): boolean {
        return other.text === this.text;
    }

    toDOM(): HTMLElement {
        const el = document.createElement("span");
        el.className = "completr-ghost-text";
        el.spellcheck = false;
        el.textContent = this.text;
        // Runs once the update that creates it has put it into the document, before it is painted
        queueMicrotask(() => matchFontOfTextBefore(el));
        return el;
    }

    // A click on the text places the cursor like a click on the line would, which hides it
    override ignoreEvent(): boolean {
        return false;
    }
}

export const inlineSuggestionField = StateField.define<InlineSuggestion | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setInlineSuggestion)) return effect.value;
        if (!value) return null;
        // Obsidian sometimes replaces text with the same text, e.g. when it renders math for the first time
        if (tr.docChanged && !isNoop(tr)) return continueTyping(value, tr);
        const { selection } = tr.state;
        return selection.ranges.length === 1 && selection.main.empty && selection.main.head === value.pos
            ? value
            : null;
    },
    provide: (field) =>
        EditorView.decorations.from(field, (value) =>
            value
                ? Decoration.set(
                      Decoration.widget({ widget: new InlineSuggestionWidget(value.text), side: 1 }).range(value.pos),
                  )
                : Decoration.none,
        ),
});

interface UpdateReasons {
    /** The user typed a character. */
    typed: boolean;
    /** The popup changed its selection or closed. */
    popup: boolean;
}

/** Schedules the updates of one editor's inline suggestion. */
class InlineSuggestionView implements PluginValue {
    private pending: UpdateReasons | null = null;
    private destroyed = false;

    constructor(
        readonly view: EditorView,
        private readonly owner: InlineSuggestions,
    ) {
        owner.views.add(this);
    }

    update(update: ViewUpdate) {
        if (!update.view.hasFocus) {
            if (update.focusChanged) this.schedule({ typed: false, popup: false });
        } else if (update.docChanged && wasTyping(update.transactions)) {
            this.schedule({ typed: true, popup: false });
        }
    }

    /** Updates the inline suggestion once the current update (if any) is done. Several requests are merged. */
    schedule(reasons: UpdateReasons) {
        if (this.pending) {
            this.pending.typed ||= reasons.typed;
            this.pending.popup ||= reasons.popup;
            return;
        }
        this.pending = { ...reasons };
        queueMicrotask(() => {
            const pending = this.pending!;
            this.pending = null;
            if (!this.destroyed) this.owner.refresh(this.view, pending);
        });
    }

    destroy() {
        this.destroyed = true;
        this.owner.views.delete(this);
    }
}

function isSame(a: InlineSuggestion | null, b: InlineSuggestion | null): boolean {
    if (!a || !b) return a === b;
    return a.suggestion === b.suggestion && a.from === b.from && a.pos === b.pos && a.text === b.text;
}

export class InlineSuggestions {
    readonly extension: Extension;
    /** The editors that are open. */
    readonly views = new Set<InlineSuggestionView>();
    private readonly viewPlugin: ViewPlugin<InlineSuggestionView>;

    constructor(private readonly plugin: CompletrPlugin) {
        this.viewPlugin = ViewPlugin.define((view) => new InlineSuggestionView(view, this));
        this.extension = [inlineSuggestionField, this.viewPlugin];
    }

    /** The inline suggestion shown in an editor, null if there is none. */
    get(view: EditorView): InlineSuggestion | null {
        return view.state.field(inlineSuggestionField, false) ?? null;
    }

    /** Called by the popup when its selection changed or it closed. */
    onPopupChanged(view: EditorView) {
        view.plugin(this.viewPlugin)?.schedule({ typed: false, popup: true });
    }

    /** Inserts the inline suggestion like the popup would. Returns false if there is none. */
    accept(view: EditorView): boolean {
        const inline = this.get(view);
        if (!inline) return false;
        const { popup } = this.plugin;
        if (popup.isOpen) popup.close();
        insertSuggestion(this.plugin, view, inline.suggestion, inline.from, inline.pos);
        return true;
    }

    /** Hides the inline suggestion until the next typed character. Returns false if there is none. */
    dismiss(view: EditorView): boolean {
        if (!this.get(view)) return false;
        view.dispatch({ effects: setInlineSuggestion.of(null) });
        return true;
    }

    /** Hides all inline suggestions, e.g. after the setting was turned off. */
    dismissAll() {
        for (const { view } of this.views) this.dismiss(view);
    }

    refresh(view: EditorView, reasons: UpdateReasons) {
        const current = view.state.field(inlineSuggestionField, false);
        if (current === undefined) return;
        const next = this.compute(view, reasons);
        if (next === undefined || isSame(current, next)) return;
        view.dispatch({ effects: setInlineSuggestion.of(next) });
    }

    /** What to show now; undefined to keep what is shown. */
    private compute(view: EditorView, reasons: UpdateReasons): InlineSuggestion | null | undefined {
        const { settings, popup } = this.plugin;
        const { selection, doc } = view.state;
        const cursor = selection.main.head;
        if (!settings.inlineSuggestions || !view.hasFocus || selection.ranges.length > 1 || !selection.main.empty)
            return null;
        if (isBeforeWordChar(doc, cursor, settings.characterRegex)) return null;

        const context = popup.isOpen ? popup.context : null;
        if (context && context.editor.cm === view) {
            // After typing, the popup reports its new list in a moment. Until then, keep what continueTyping kept.
            if (!reasons.popup) return undefined;
            const item = popup.getSelectedItem();
            if (!item || context.editor.posToOffset(context.end) !== cursor) return null;
            return getInlineSuggestion(item, doc, cursor, context.editor.posToOffset(context.start));
        }

        // The automatic popup computes the suggestions itself and reports them when it opens.
        if (!reasons.typed || settings.autoTrigger || this.isOtherSuggestOpen()) return null;
        return this.computeFromProviders(view, cursor);
    }

    /** E.g. Obsidian's link suggestions: Tab and Escape belong to it. */
    private isOtherSuggestOpen(): boolean {
        const current = this.plugin.app.workspace.editorSuggest?.currentSuggest;
        return !!current && current !== this.plugin.popup && current.isOpen;
    }

    private computeFromProviders(view: EditorView, cursor: number): InlineSuggestion | null {
        const editor = view.state.field(editorInfoField, false)?.editor;
        if (!editor || editor.cm !== view) return null;

        const { doc } = view.state;
        const line = doc.lineAt(cursor);
        const end = { line: line.number - 1, ch: cursor - line.from };
        const word = getWordBeforeCursor(line.text, end.ch, this.plugin.settings);
        const { suggestions, start } = computeSuggestions(
            this.plugin,
            createSuggestionContext(editor, end, word, false),
        );
        const queryStart = start ? toOffset(doc, start) : cursor - word.query.length;
        return findInlineSuggestion(suggestions, doc, cursor, queryStart);
    }
}
