import type { ViewUpdate } from "@codemirror/view";
import {
    type App,
    type Editor,
    type EditorPosition,
    EditorSuggest,
    type EditorSuggestContext,
    type EditorSuggestTriggerInfo,
    renderMatches,
    setIcon,
    type TFile,
} from "obsidian";
import { getCursorContext } from "./editor_context.ts";
import type CompletrPlugin from "./main.ts";
import type { Suggestion, SuggestionContext } from "./provider/provider.ts";
import { IconMode } from "./settings.ts";
import { insertSnippet } from "./snippets.ts";
import { compileCharacterClass, DEFAULT_CHARACTER_REGEX, matchWordBackwards } from "./text.ts";

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1,
}

const MAX_SUGGESTIONS = 100;

export class SuggestionPopup extends EditorSuggest<Suggestion> {
    /** Whether an item is selected, i.e. Enter inserts it. Without focus, keys go to the editor. */
    private focused = false;
    /** Set while the popup is opened through the "open suggestion popup" command. */
    private manualTrigger = false;
    /** Whether the last change of the focused editor was the user typing a character. */
    private lastChangeWasTyping = false;
    private separatorChar: string | null = null;
    private wordCharRegex: { source: string; regex: RegExp } | null = null;

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
            this.lastChangeWasTyping = update.transactions.some((tr) => tr.isUserEvent("input.type"));
        } else if (update.selectionSet) {
            this.lastChangeWasTyping = false;
            if (this.isOpen) this.close();
        }
    }

    /** Opens the popup for the word in front of the cursor, ignoring the auto trigger and minimum length settings. */
    triggerManually(editor: Editor, file: TFile | null) {
        this.manualTrigger = true;
        try {
            this.trigger(editor, file, true);
        } finally {
            this.manualTrigger = false;
        }
    }

    /** Re-computes the suggestions, e.g. after one was blacklisted. */
    refresh() {
        const ctx = this.context;
        if (!ctx) return;
        this.triggerManually(ctx.editor, ctx.file);
    }

    private isWordChar(char: string): boolean {
        const source = this.settings.characterRegex;
        if (this.wordCharRegex?.source !== source) {
            const regex = compileCharacterClass(source) ?? compileCharacterClass(DEFAULT_CHARACTER_REGEX)!;
            this.wordCharRegex = { source, regex };
        }
        return this.wordCharRegex.regex.test(char);
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        if (!this.manualTrigger && !this.isOpen && !(this.settings.autoTrigger && this.lastChangeWasTyping))
            return null;

        const line = editor.getLine(cursor.line);
        const { query, separatorChar } = matchWordBackwards(
            line,
            cursor.ch,
            (c) => this.isWordChar(c),
            this.settings.maxLookBackDistance,
        );
        this.separatorChar = separatorChar;
        return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
    }

    getSuggestions(context: EditorSuggestContext): Suggestion[] {
        const { editor } = context;
        const state = editor.cm.state;
        let inCode: boolean | undefined;
        const ctx: SuggestionContext = {
            editor,
            state,
            file: context.file,
            start: context.start,
            end: context.end,
            query: context.query,
            separatorChar: this.separatorChar,
            line: editor.getLine(context.end.line),
            manual: this.manualTrigger,
            get inCode() {
                return (inCode ??= getCursorContext(state, editor.posToOffset(context.end)).inCode);
            },
        };

        let suggestions: Suggestion[] = [];
        for (const provider of this.plugin.providers) {
            const result = provider.getSuggestions(ctx, this.settings);
            if (result.length === 0) continue;
            for (const s of result) s.providerId = provider.id;

            if (provider.blocksAllOtherProviders) {
                suggestions = result;
                // Position the popup where the replacement starts
                const start = result.find((s) => s.overrideStart)?.overrideStart;
                if (start) context.start = start;
                break;
            }
            suggestions.push(...result);
        }

        const seen = new Set<string>();
        const { blacklist, usage } = this.plugin;
        suggestions = suggestions.filter((s) => {
            if (seen.has(s.displayName) || blacklist.has(s.displayName)) return false;
            seen.add(s.displayName);
            return true;
        });

        if (this.settings.rankByUsage) {
            // Stable sort: frequently used first, but never above better (non-fuzzy) matches
            suggestions.sort(
                (a, b) =>
                    Number(!!a.isFuzzy) - Number(!!b.isFuzzy) || usage.get(b.displayName) - usage.get(a.displayName),
            );
        }

        return suggestions.slice(0, MAX_SUGGESTIONS);
    }

    renderSuggestion(value: Suggestion, el: HTMLElement): void {
        el.addClass("completr-suggestion-item");
        if (value.color) el.style.setProperty("--completr-suggestion-color", value.color);

        const mode = this.settings.iconMode;
        const icon =
            mode === IconMode.NONE
                ? undefined
                : (value.icon ??
                  (mode === IconMode.SUGGESTION_OR_PROVIDER
                      ? this.plugin.getProviderIcon(value.providerId)
                      : undefined));
        if (icon) setIcon(el.createDiv({ cls: "completr-suggestion-icon" }), icon);

        const text = el.createDiv({ cls: "completr-suggestion-text" });
        if (value.matches?.length) renderMatches(text, value.displayName, value.matches);
        else text.setText(value.displayName);
    }

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
        if (value.isSnippet) {
            insertSnippet(editor.cm, from, to, replacement);
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
