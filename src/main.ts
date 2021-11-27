import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    MarkdownView,
    Plugin,
    TFile,
} from "obsidian";
import {GermanWords} from "./provider/german_words";
import SuggestionProvider from "./provider/provider";
import {Latex} from "./provider/latex_provider";
import * as CodeMirror from "codemirror";
import SnippetManager from "./snippet_manager";
import {MarkerRange} from "codemirror";

export default class CompleterPlugin extends Plugin {

    private snippetManager: SnippetManager;

    async onload() {
        this.snippetManager = new SnippetManager();

        this.registerEditorSuggest(new SuggestionPopup(this.app, this.snippetManager));
        this.registerCodeMirror(cm => cm.on('keydown', this.handleKeydown));
    }

    private readonly handleKeydown = (cm: CodeMirror.Editor, event: KeyboardEvent) => {
        if (!["Enter", "Tab"].contains(event.key))
            return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view)
            return;

        const editor = view.editor;

        let placeholder = this.snippetManager.placeholderAtPos(editor, editor.getCursor());
        if (!placeholder)
            return;
        let placeholderEnd = (placeholder.marker.find() as MarkerRange).to

        event.preventDefault();
        if (!this.snippetManager.consumeAndGotoNextMarker(editor)) {
            editor.setSelections([]);
            editor.setCursor({
                ...placeholderEnd,
                ch: Math.min(editor.getLine(placeholderEnd.line).length, placeholderEnd.ch + 1)
            });
        }
    }

    onunload() {
        this.app.workspace.iterateCodeMirrors((cm) => {
            cm.off('keydown', this.handleKeydown);
        })

        this.snippetManager.onunload();
    }
}

const MAX_LOOK_BACK_DISTANCE = 50;
const SEPARATORS = " ,.[]{}()$*+-/?|&#";
const PROVIDERS: SuggestionProvider[] = [Latex, GermanWords];

class SuggestionPopup extends EditorSuggest<string> {
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
        for (let provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions(context)];
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
        el.addClass("completer-suggestion-item");
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
