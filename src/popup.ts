import type { ViewUpdate } from "@codemirror/view";
import { around } from "monkey-around";
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
import { guarded } from "./errors.ts";
import { BLACKLIST_COMMAND, getHotkeyLabel } from "./hotkeys.ts";
import { renderLatexPreview } from "./latex_preview.ts";
import type CompletrPlugin from "./main.ts";
import { CustomEntryModal } from "./modals.ts";
import type { Suggestion } from "./provider/provider.ts";
import { IconMode } from "./settings.ts";
import {
    computeSuggestions,
    createSuggestionContext,
    getWordBeforeCursor,
    insertSuggestion,
    MAX_SUGGESTIONS,
} from "./suggestions.ts";
import { wasTyping } from "./typing.ts";

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1,
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

        // The inline suggestion follows the selected item. A new list selects its first item, the arrow keys and the
        // mouse move the selection: all of them end up here.
        const onSelectionChanged = () => {
            const editor = this.context?.editor;
            if (editor) plugin.inlineSuggestions.onPopupChanged(editor.cm);
        };
        around(this.suggestions, {
            setSelectedItem: (next) =>
                function (this: unknown, ...args) {
                    next.apply(this, args);
                    onSelectionChanged();
                },
        });
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
        const editor = this.isOpen ? this.context?.editor : undefined;
        super.close();
        this.focused = false;
        this.manual = false;
        // Obsidian triggers suggests a moment after a keystroke. That trigger must not reopen the popup when it was
        // closed in between, e.g. with Escape right after typing.
        this.lastChangeWasTyping = false;
        if (editor) this.plugin.inlineSuggestions.onPopupChanged(editor.cm);
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
            const typing = wasTyping(update.transactions);
            if (typing !== null) {
                this.lastChangeWasTyping = typing;
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

        const { query, separatorChar } = getWordBeforeCursor(editor.getLine(cursor.line), cursor.ch, this.settings);
        this.separatorChar = separatorChar;
        // The word the popup was opened on is finished, from now on the automatic rules apply
        if (query.length === 0 && this.changedSinceManualTrigger) this.manual = false;
        return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
    }

    getSuggestions(context: EditorSuggestContext): Suggestion[] {
        const { suggestions, start } = computeSuggestions(
            this.plugin,
            createSuggestionContext(
                context.editor,
                context.end,
                { query: context.query, separatorChar: this.separatorChar },
                this.manual,
            ),
        );
        // Position the popup where the replacement starts
        if (start) context.start = start;
        return suggestions;
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

        const end = value.overrideEnd ?? ctx.end;
        const from = editor.posToOffset(value.overrideStart ?? ctx.start);
        const to = editor.posToOffset({ line: end.line, ch: Math.min(end.ch, editor.getLine(end.line).length) });

        this.close();
        insertSuggestion(this.plugin, editor.cm, value, from, to);
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
