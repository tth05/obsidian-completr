import SuggestionProvider from "./provider/provider";
import {Latex} from "./provider/latex_provider";
import {WordList} from "./provider/word_list_provider";
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

const MAX_LOOK_BACK_DISTANCE = 50;
const SEPARATORS = " ,.[]{}()$*+-/?|&#";
const PROVIDERS: SuggestionProvider[] = [Latex, WordList];

export default class SuggestionPopup extends EditorSuggest<string> {
    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;
    private snippetManager: SnippetManager;

    constructor(app: App, snippetManager: SnippetManager) {
        super(app);
        this.snippetManager = snippetManager;
    }

    getSuggestions(
        context: EditorSuggestContext
    ): string[] | Promise<string[]> {
        if (!context.query) return [];
        let suggestions: string[] = [];

        const time = window.performance.now();
        for (let provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions(context)];
        }

        console.log((window.performance.now() - time));
        return suggestions;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        if (this.justClosed) {
            this.justClosed = false;
            return null;
        }
        if (cursor.ch == 0)
            return null;

        let query = "";
        //Save some time for very long lines
        let lookBackEnd = Math.max(0, cursor.ch - MAX_LOOK_BACK_DISTANCE);
        //Find word in front of cursor
        for (let i = cursor.ch - 1; i >= lookBackEnd; i--) {
            const prevChar = editor.getRange({...cursor, ch: i}, {...cursor, ch: i + 1});
            if (SEPARATORS.contains(prevChar))
                break;

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

    renderSuggestion(value: string, el: HTMLElement): void {
        el.addClass("completr-suggestion-item");
        el.setText(value);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.context.editor.replaceRange(value, this.context.start, this.context.end);

        //Check if suggestion is a snippet
        if (value.contains("#")) {
            this.snippetManager.handleSnippet(value, this.context.start, this.context.editor);
        }

        this.close();
        this.justClosed = true;
    }
}
