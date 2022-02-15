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
import {FrontMatter} from "./provider/front_matter_provider";
import {matchWordBackwards} from "./editor_helpers";

const PROVIDERS: SuggestionProvider[] = [FrontMatter, Latex, FileScanner, WordList];

export default class SuggestionPopup extends EditorSuggest<Suggestion> {
    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;
    private separatorChar: string;

    private characterRegex: string;
    private compiledCharacterRegex: RegExp;

    private tabKeybindRegistration: Object;

    private readonly snippetManager: SnippetManager;
    private readonly settings: CompletrSettings;
    private readonly disableSnippets: boolean;

    constructor(app: App, settings: CompletrSettings, snippetManager: SnippetManager) {
        super(app);
        this.disableSnippets = (app.vault as any).config?.legacyEditor;
        this.settings = settings;
        this.snippetManager = snippetManager;

        this.setTabInsertionEnabled(settings.enableTabKeyForCompletionInsertion);
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
                    if (typeof suggestion === "string" || !suggestion.overrideStart)
                        return;

                    //Fixes popup position
                    this.context.start = suggestion.overrideStart;
                });
                break;
            }
        }

        return suggestions;
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
        el.setText(getSuggestionDisplayName(value));
    }

    selectSuggestion(value: Suggestion, evt: MouseEvent | KeyboardEvent): void {
        const replacement = getSuggestionReplacement(value);
        const start = typeof value !== "string" && value.overrideStart ? value.overrideStart : this.context.start;
        this.context.editor.replaceRange(replacement, start, this.context.end);

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

    setTabInsertionEnabled(val: boolean) {
        let self = this as any;
        this.disableTabInsertion();

        if (val) {
            this.tabKeybindRegistration = self.scope.register([], "Tab", (event: Event) => {
                self.suggestions.useSelectedItem(event);
                return false;
            });
        }
    }

    private disableTabInsertion() {
        let self = this as any;

        if (this.tabKeybindRegistration)
            self.scope.unregister(this.tabKeybindRegistration);
    }

    private getCharacterRegex(): RegExp {
        if (this.characterRegex !== this.settings.characterRegex)
            this.compiledCharacterRegex = new RegExp("[" + this.settings.characterRegex + "]", "u");

        return this.compiledCharacterRegex;
    }
}
