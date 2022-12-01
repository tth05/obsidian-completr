import {Suggestion, SuggestionProvider} from "./provider/provider";
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
import {FrontMatter} from "./provider/front_matter_provider";
import {matchWordBackwards} from "./editor_helpers";
import {SuggestionBlacklist} from "./provider/blacklist";

const PROVIDERS: SuggestionProvider[] = [FrontMatter, Latex, FileScanner, WordList];

export default class SuggestionPopup extends EditorSuggest<Suggestion> {
    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;
    private separatorChar: string;

    private characterRegex: string;
    private compiledCharacterRegex: RegExp;

    private readonly snippetManager: SnippetManager;
    private readonly settings: CompletrSettings;
    private readonly disableSnippets: boolean;

    constructor(app: App, settings: CompletrSettings, snippetManager: SnippetManager) {
        super(app);
        this.disableSnippets = (app.vault as any).config?.legacyEditor;
        this.settings = settings;
        this.snippetManager = snippetManager;

        //Remove default key registrations
        let self = this as any;
        self.scope.keys = [];
    }

    getSuggestions(
        context: EditorSuggestContext
    ): Suggestion[] | Promise<Suggestion[]> {
        let suggestions: Suggestion[] = [];

        for (let provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions({
                ...context,
                separatorChar: this.separatorChar
            }, this.settings)];

            if (provider.blocksAllOtherProviders && suggestions.length > 0) {
                suggestions.forEach((suggestion) => {
                    if (!suggestion.overrideStart)
                        return;

                    // Fixes popup position
                    this.context.start = suggestion.overrideStart;
                });
                break;
            }
        }

        const seen = new Set<string>();
        suggestions = suggestions.filter((suggestion) => {
            if (seen.has(suggestion.displayName))
                return false;

            seen.add(suggestion.displayName);
            return true;
        });
        return suggestions.length === 0 ? null : suggestions.filter(s => !SuggestionBlacklist.has(s));
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        if (this.justClosed) {
            this.justClosed = false;
            return null;
        }

        let {
            query,
            separatorChar
        } = matchWordBackwards(editor, cursor, (char) => this.getCharacterRegex().test(char), this.settings.maxLookBackDistance);
        this.separatorChar = separatorChar;

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
        el.setText(value.displayName);
    }

    selectSuggestion(value: Suggestion, evt: MouseEvent | KeyboardEvent): void {
        const replacement = value.replacement;
        const start = typeof value !== "string" && value.overrideStart ? value.overrideStart : this.context.start;

        const endPos = value.overrideEnd ?? this.context.end;
        this.context.editor.replaceRange(replacement, start, {
            ...endPos,
            ch: Math.min(endPos.ch, this.context.editor.getLine(endPos.line).length)
        });

        //Check if suggestion is a snippet
        if (replacement.contains("#") || replacement.contains("~")) {
            if (!this.disableSnippets) {
                this.snippetManager.handleSnippet(replacement, start, this.context.editor);
            } else {
                console.log("Completr: Please enable Live Preview mode to use snippets");
            }
        } else {
            this.context.editor.setCursor({...start, ch: start.ch + replacement.length});
        }

        this.close();
        this.justClosed = true;
    }

    selectNextItem(dir: SelectionDirection) {
        const self = this as any;
        // HACK: The second parameter has to be an instance of KeyboardEvent to force scrolling the selected item into
        // view
        self.suggestions.setSelectedItem(self.suggestions.selectedItem + dir, new KeyboardEvent("keydown"));
    }

    getSelectedItem(): Suggestion {
        const self = this as any;
        return self.suggestions.values[self.suggestions.selectedItem];
    }

    applySelectedItem() {
        const self = this as any;
        self.suggestions.useSelectedItem();
    }

    isVisible(): boolean {
        return (this as any).isOpen;
    }

    preventNextTrigger() {
        this.justClosed = true;
    }

    private getCharacterRegex(): RegExp {
        if (this.characterRegex !== this.settings.characterRegex)
            this.compiledCharacterRegex = new RegExp("[" + this.settings.characterRegex + "]", "u");

        return this.compiledCharacterRegex;
    }

}

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1
}
