import { Transaction } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import {
    type App,
    type Editor,
    type EditorPosition,
    EditorSuggest,
    type EditorSuggestContext,
    type EditorSuggestTriggerInfo,
    Notice,
    renderMatches,
    setIcon,
    setTooltip,
    type TFile,
} from "obsidian";
import { type CursorContext, getCursorContext, getLatexContext, type MathType } from "./editor_context.ts";
import { guarded } from "./errors.ts";
import { BLACKLIST_COMMAND, getHotkeyLabel } from "./hotkeys.ts";
import { renderLatexPreview } from "./latex_preview.ts";
import type CompletrPlugin from "./main.ts";
import { CustomEntryModal } from "./modals.ts";
import type { Suggestion, SuggestionContext } from "./provider/provider.ts";
import { IconMode } from "./settings.ts";
import { insertSnippet } from "./snippets.ts";
import { isWordChar, matchWordBackwards } from "./text.ts";

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1,
}

const MAX_SUGGESTIONS = 100;

/**
 * Whether a transaction is the user typing. Besides CodeMirror's own "input.type" transactions, this accepts changes
 * without a user event that add exactly one character in front of the cursor. That's how plugins that handle typing
 * themselves insert it (e.g. LaTeX Suite replaces "\a" with "\al" when "l" is typed).
 */
function isTyping(tr: Transaction): boolean {
    if (tr.isUserEvent("input.type")) return true;
    if (tr.annotation(Transaction.userEvent) !== undefined || !tr.docChanged) return false;

    const before = tr.startState.selection.main;
    const after = tr.state.selection.main;
    if (!before.empty || !after.empty) return false;

    let count = 0;
    let typed = false;
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
        count++;
        typed =
            toA === before.head &&
            toB === after.head &&
            inserted.length - (toA - fromA) === 1 &&
            !inserted.sliceString(inserted.length - 1).includes("\n");
    });
    return count === 1 && typed;
}

/** Whether a transaction changes the document without changing its content (e.g. replacing "$" with "$"). */
function isNoop(tr: Transaction): boolean {
    let noop = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (noop && tr.startState.doc.sliceString(fromA, toA) !== inserted.toString()) noop = false;
    });
    return noop;
}

export class SuggestionPopup extends EditorSuggest<Suggestion> {
    /** Whether an item is selected, i.e. Enter inserts it. Without focus, keys go to the editor. */
    private focused = false;
    /**
     * Whether the popup was opened with the "open suggestion popup" command, so the minimum length settings are ignored.
     * Ends when the popup closes, or when the query is empty after the user changed the document (the word is finished).
     */
    private manual = false;
    private changedSinceManualTrigger = false;
    /** Whether the last change of the focused editor was the user typing a character. */
    private lastChangeWasTyping = false;
    private separatorChar: string | null = null;

    constructor(
        app: App,
        private readonly plugin: CompletrPlugin,
    ) {
        super(app);
        this.limit = MAX_SUGGESTIONS;
        // Remove the default key handlers (arrows, Enter, Escape, ...). Completr's commands handle these instead, so
        // their hotkeys can be configured.
        for (const handler of [...this.scope.keys]) this.scope.unregister(handler);
    }

    private get settings() {
        return this.plugin.settings;
    }

    override open() {
        const wasOpen = this.isOpen;
        super.open();
        if (!wasOpen) this.setFocused(this.settings.autoFocus);
    }

    override close() {
        super.close();
        this.focused = false;
        this.manual = false;
    }

    private setFocused(focused: boolean) {
        this.focused = focused;
        this.suggestEl.toggleClass("completr-unfocused", !focused);
    }

    isFocused(): boolean {
        return this.isOpen && this.focused;
    }

    /** Called for every update of every editor. Tracks typing and closes the popup when the cursor is moved. */
    onEditorUpdate(update: ViewUpdate) {
        if (!update.view.hasFocus) return;
        if (update.docChanged) {
            // Indenting, pasting, deleting, ... should not open the popup, only typing does.
            const changes = update.transactions.filter((tr) => tr.docChanged && !isNoop(tr));
            if (changes.length > 0) {
                this.lastChangeWasTyping = changes.some(isTyping);
                this.changedSinceManualTrigger = true;
            }
        } else if (update.selectionSet) {
            this.lastChangeWasTyping = false;
            if (this.isOpen) this.close();
        }
    }

    /** Opens the popup for the word in front of the cursor, ignoring the auto trigger and minimum length settings. */
    triggerManually(editor: Editor, file: TFile | null) {
        this.manual = true;
        this.changedSinceManualTrigger = false;
        this.trigger(editor, file, true);
        // Nothing to suggest: Obsidian only calls close() if the popup was open
        if (!this.isOpen) this.manual = false;
    }

    /** Re-computes the suggestions, e.g. after one was blacklisted. */
    refresh() {
        const ctx = this.context;
        if (ctx && this.isOpen) this.trigger(ctx.editor, ctx.file, true);
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        if (!this.manual && !this.isOpen && !(this.settings.autoTrigger && this.lastChangeWasTyping)) return null;

        const line = editor.getLine(cursor.line);
        const { query, separatorChar } = matchWordBackwards(
            line,
            cursor.ch,
            (c) => isWordChar(c, this.settings.characterRegex),
            this.settings.maxLookBackDistance,
        );
        this.separatorChar = separatorChar;
        // The word the popup was opened on is finished, from now on the automatic rules apply
        if (query.length === 0 && this.changedSinceManualTrigger) this.manual = false;
        return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
    }

    private createContext(context: EditorSuggestContext): SuggestionContext {
        const { editor } = context;
        const state = editor.cm.state;
        const offset = editor.posToOffset(context.end);
        // Looking at the syntax tree is the expensive part, and several providers ask the same questions
        let cursor: CursorContext | undefined;
        const getCursor = () => (cursor ??= getCursorContext(state, offset));
        const mathTypes = new Map<boolean, MathType | null>();

        return {
            editor,
            state,
            end: context.end,
            query: context.query,
            separatorChar: this.separatorChar,
            line: editor.getLine(context.end.line),
            manual: this.manual,
            get inCode() {
                return getCursor().inCode;
            },
            mathType(triggerInCode) {
                let type = mathTypes.get(triggerInCode);
                if (type === undefined) {
                    type = getLatexContext(state, offset, triggerInCode, getCursor());
                    mathTypes.set(triggerInCode, type);
                }
                return type;
            },
        };
    }

    getSuggestions(context: EditorSuggestContext): Suggestion[] {
        const ctx = this.createContext(context);

        let suggestions: Suggestion[] = [];
        for (const provider of this.plugin.providers) {
            const result = provider.getSuggestions(ctx, this.settings);
            if (result.length === 0) continue;
            for (const s of result) s.provider = provider;

            if (provider.blocksAllOtherProviders) {
                suggestions = result;
                // Position the popup where the replacement starts
                const start = result.find((s) => s.overrideStart)?.overrideStart;
                if (start) context.start = start;
                break;
            }
            suggestions.push(...result);
        }

        // The one place where the blacklist is applied
        const seen = new Set<string>();
        const { blacklist, usage } = this.plugin;
        suggestions = suggestions.filter((s) => {
            if (seen.has(s.displayName) || blacklist.has(s.displayName)) return false;
            seen.add(s.displayName);
            return true;
        });

        // Stable sort: the providers' order is kept, except that fuzzy matches of one provider never come before the
        // better matches of another, and (optionally) that frequently used suggestions come first within those groups.
        const byUsage = this.settings.rankByUsage;
        suggestions.sort(
            (a, b) =>
                Number(!!a.isFuzzy) - Number(!!b.isFuzzy) ||
                (byUsage ? usage.get(b.displayName) - usage.get(a.displayName) : 0),
        );

        return suggestions.slice(0, MAX_SUGGESTIONS);
    }

    renderSuggestion(value: Suggestion, el: HTMLElement): void {
        el.addClass("completr-suggestion-item");
        if (value.color) el.style.setProperty("--completr-suggestion-color", value.color);

        const mode = this.settings.iconMode;
        const icon =
            mode === IconMode.NONE
                ? undefined
                : (value.icon ?? (mode === IconMode.SUGGESTION_OR_PROVIDER ? value.provider?.icon : undefined));
        if (icon) setIcon(el.createDiv({ cls: "completr-suggestion-icon" }), icon);

        const text = el.createDiv({ cls: "completr-suggestion-text" });
        if (value.matches?.length) renderMatches(text, value.displayName, value.matches);
        else text.setText(value.displayName);

        if (value.detail) el.createDiv({ cls: "completr-suggestion-detail", text: value.detail });
        if (value.previewTex && this.settings.latexPreview)
            renderLatexPreview(el.createDiv({ cls: "completr-suggestion-preview" }), value.previewTex);

        this.renderActions(value, el);
    }

    /** Buttons that appear when hovering a suggestion. */
    private renderActions(value: Suggestion, el: HTMLElement) {
        const actions = el.createDiv({ cls: "completr-suggestion-actions" });
        const add = (icon: string, tooltip: string, run: () => unknown) => {
            const button = actions.createDiv({ cls: "completr-suggestion-action" });
            setIcon(button, icon);
            setTooltip(button, tooltip);
            button.addEventListener("click", (evt) => {
                // Don't insert the suggestion
                evt.stopPropagation();
                void run();
            });
        };

        const file = value.provider?.customEntries;
        const entry = value.customEntry;
        if (file && entry) add("pencil", file.kind.editTitle, () => this.editCustomEntry(value));

        const hotkey = getHotkeyLabel(this.plugin, BLACKLIST_COMMAND);
        add("eye-off", "Never suggest this" + (hotkey ? ` (${hotkey})` : ""), () => this.hideSuggestion(value));
    }

    private editCustomEntry(value: Suggestion) {
        const file = value.provider?.customEntries;
        if (!file || !value.customEntry) return;
        this.close();
        new CustomEntryModal(this.app, file, { existing: value.customEntry }).open();
    }

    /** Adds a suggestion to the blacklist, with a way to undo it. */
    readonly hideSuggestion = guarded(async (value: Suggestion) => {
        const name = value.displayName;
        await this.plugin.blacklistSuggestion(name);

        const message = createFragment((fragment) => {
            fragment.appendText(`Completr: "${name}" won't be suggested anymore. `);
            const undo = fragment.createEl("a", { text: "Undo" });
            // Keep the focus in the editor
            undo.addEventListener("mousedown", (evt) => evt.preventDefault());
            undo.addEventListener(
                "click",
                guarded(() => this.plugin.blacklist.remove(name)),
            );
        });
        new Notice(message, 6000);
    });

    selectSuggestion(value: Suggestion): void {
        const ctx = this.context;
        if (!ctx) return;
        const { editor } = ctx;

        const start = value.overrideStart ?? ctx.start;
        const end = value.overrideEnd ?? ctx.end;
        const from = editor.posToOffset(start);
        const to = editor.posToOffset({ line: end.line, ch: Math.min(end.ch, editor.getLine(end.line).length) });

        let replacement = value.replacement;
        if (value.appendSpace && !/^\s/.test(editor.cm.state.doc.sliceString(to, to + 1))) replacement += " ";

        this.close();
        if (value.snippet) {
            insertSnippet(editor.cm, from, to, replacement, value.snippet);
        } else {
            editor.cm.dispatch({
                changes: { from, to, insert: replacement },
                selection: { anchor: from + replacement.length },
                scrollIntoView: true,
            });
        }

        if (this.settings.rankByUsage) this.plugin.usage.record(value.displayName);
    }

    selectNextItem(dir: SelectionDirection) {
        const { suggestions } = this;
        if (!this.focused) {
            this.setFocused(true);
            // The first item is already selected (just not highlighted). Going up from there wraps to the last one.
            if (dir === SelectionDirection.NEXT) {
                suggestions.setSelectedItem(0, new KeyboardEvent("keydown"));
                return;
            }
        }
        // Passing a KeyboardEvent makes Obsidian scroll the selected item into view
        suggestions.setSelectedItem(suggestions.selectedItem + dir, new KeyboardEvent("keydown"));
    }

    getSelectedItem(): Suggestion | undefined {
        return this.suggestions.values[this.suggestions.selectedItem];
    }

    applySelectedItem() {
        this.suggestions.useSelectedItem();
    }
}
