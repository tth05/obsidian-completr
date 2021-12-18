import {getSuggestionDisplayName, getSuggestionReplacement, Suggestion, SuggestionProvider} from "./provider/provider";
import {Latex} from "./provider/latex_provider";
import {WordList} from "./provider/word_list_provider";
import {FileScanner} from "./provider/scanner_provider";
import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    TFile
} from "obsidian";
import SnippetManager from "./snippet_manager";
import {CompletrSettings} from "./settings";

const PROVIDERS: SuggestionProvider[] = [Latex, FileScanner, WordList];

export default class SuggestionPopup extends EditorSuggest<Suggestion> {
    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;
    private separatorChar: string;

    private readonly snippetManager: SnippetManager;
    private readonly settings: CompletrSettings;

    constructor(app: App, settings: CompletrSettings, snippetManager: SnippetManager) {
        super(app);
        this.settings = settings;
        this.snippetManager = snippetManager;
    }

    getSuggestions(
        context: EditorSuggestContext
    ): Suggestion[] | Promise<Suggestion[]> {
        if (!context.query)
            return [];

        let suggestions: Suggestion[] = [];

        for (let provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions({
                ...context,
                separatorChar: this.separatorChar
            }, this.settings)];
        }

        return suggestions;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        if (this.justClosed) {
            this.justClosed = false;
            return null;
        }
        if (cursor.ch == 0)
            return null;

        this.separatorChar = null;

        let query = "";
        //Save some time for very long lines
        let lookBackEnd = Math.max(0, cursor.ch - this.settings.maxLookBackDistance);
        //Find word in front of cursor
        for (let i = cursor.ch - 1; i >= lookBackEnd; i--) {
            const prevChar = editor.getRange({...cursor, ch: i}, {...cursor, ch: i + 1});
            if (this.settings.wordSeparators.contains(prevChar)) {
                this.separatorChar = prevChar;
                break;
            }

            query = prevChar + query;
        }

        return {
            start: {
                ...cursor,
                ch: cursor.ch - query.length,
            },
            end: cursor,
            query: query,
        };
    }

    renderSuggestion(value: Suggestion, el: HTMLElement): void {
        el.addClass("completr-suggestion-item");
        el.setText(getSuggestionDisplayName(value));
    }

    selectSuggestion(value: Suggestion, evt: MouseEvent | KeyboardEvent): void {
        const replacement = getSuggestionReplacement(value);
        this.context.editor.replaceRange(replacement, this.context.start, this.context.end);

        //Check if suggestion is a snippet
        if (replacement.contains("#")) {
            this.snippetManager.handleSnippet(replacement, this.context.start, this.context.editor);
        }

        this.close();
        this.justClosed = true;
    }
}
