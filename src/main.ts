import {
    Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo,
    Plugin,
    TFile
} from 'obsidian';
import {GermanWords} from "./provider/german_words";
import SuggestionProvider from "./provider/provider";

export default class CompleterPlugin extends Plugin {
    async onload() {
        this.registerEditorSuggest(new SuggestionPopup(this.app));
    }

    onunload() {

    }
}

const MAX_LOOK_BACK_DISTANCE = 50;
const SEPARATORS = [" ", ",", ".", "[", "]", "{", "}", "(", ")"];
const PROVIDERS: SuggestionProvider[] = [GermanWords]

class SuggestionPopup extends EditorSuggest<string> {

    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;

    getSuggestions(context: EditorSuggestContext): string[] | Promise<string[]> {
        if (!context.query)
            return [];
        let suggestions: string[] = [];
        for (let provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions(context)];
        }
        return suggestions.filter(s => s.toLowerCase().startsWith(context.query.toLowerCase()));
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

            query = prevChar + query
        }

        return {
            start: {
                ...cursor,
                ch: cursor.ch - query.length,
            },
            end: cursor,
            query: query
        };
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.addClass("completer-suggestion-item");
        el.setText(value);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.context.editor.replaceRange(value, this.context.start, this.context.end);
        this.close()
        this.justClosed = true;
    }
}
