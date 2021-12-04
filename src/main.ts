import {
    MarkdownView,
    Plugin,
} from "obsidian";
import * as CodeMirror from "codemirror";
import SnippetManager from "./snippet_manager";
import {MarkerRange} from "codemirror";
import SuggestionPopup from "./popup";
import CompletrSettingsTab, {CompletrSettings, DEFAULT_SETTINGS} from "./settings";
import {WordList} from "./provider/word_list_provider";

export default class CompletrPlugin extends Plugin {

    settings: CompletrSettings;

    private snippetManager: SnippetManager;
    private suggestionPopup: SuggestionPopup;

    private cursorTriggeredByChange = false;

    async onload() {
        await this.loadSettings();

        this.snippetManager = new SnippetManager();
        this.suggestionPopup = new SuggestionPopup(this.app, this.settings, this.snippetManager);

        this.registerEditorSuggest(this.suggestionPopup);
        this.registerCodeMirror(cm => {
            cm.on('keydown', this.handleKeydown);
            cm.on('beforeChange', this.handleBeforeChange);
            cm.on('cursorActivity', this.handleCursorActivity);
        });

        this.addSettingTab(new CompletrSettingsTab(this.app, this));

        //TODO: Manual triggering of popup, requires some hackery?
        /*this.addCommand({
            id: 'completr-open-suggestion-popup',
            name: 'Open suggestion popup',
            hotkeys: [
                {
                    key: "Space",
                    modifiers: ["Mod"]
                }
            ],
            editorCallback: (editor) => {
                const info = this.suggestionPopup.getSuggestions();
                if(!info)
                    return;
                const context = {
                    ...info,
                    editor: editor,
                    file: theActiveFile
                }
                this.suggestionPopup.showSuggestions(this.suggestionPopup.getSuggestions(context));
            }
        })*/

        //TODO: Settings
        // - Insertion mode: Replace, Append
        // - Auto trigger
        // - Customize "rainbow" colors for nested snippets
        // - Specify word separators
        // - Max look back distance
        // - Disable file scanning
        // - Delay between scanned lines
        // - Only remember scanned words over length X
    }

    onunload() {
        this.app.workspace.iterateCodeMirrors((cm) => {
            cm.off('keydown', this.handleKeydown);
            cm.off('beforeChange', this.handleBeforeChange);
            cm.off('cursorActivity', this.handleCursorActivity);
        })

        this.snippetManager.onunload();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        await WordList.loadFromFiles(this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private readonly handleBeforeChange = (cm: CodeMirror.Editor) => {
        this.cursorTriggeredByChange = true;
    };

    private readonly handleCursorActivity = (cm: CodeMirror.Editor) => {
        if (this.cursorTriggeredByChange) {
            this.cursorTriggeredByChange = false;
            return;
        }

        this.suggestionPopup.close();
        if (!this.snippetManager.placeholderAtPos(cm as any, cm.getCursor())) {
            this.snippetManager.clearAllPlaceholders();
        }
    };

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
}
