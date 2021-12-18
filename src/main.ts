import {
    MarkdownView,
    Plugin, TFile,
} from "obsidian";
import * as CodeMirror from "codemirror";
import SnippetManager from "./snippet_manager";
import {MarkerRange} from "codemirror";
import SuggestionPopup from "./popup";
import {CompletrSettings, DEFAULT_SETTINGS} from "./settings";
import {WordList} from "./provider/word_list_provider";
import {FileScanner} from "./provider/scanner_provider";
import CompletrSettingsTab from "./settings_tab";

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

        this.app.workspace.on('file-open', this.onFileOpened, this);

        this.addSettingTab(new CompletrSettingsTab(this.app, this));


        //TODO: Manual triggering of popup, requires some hackery?
        this.addCommand({
            id: 'completr-open-suggestion-popup',
            name: 'Open suggestion popup',
            hotkeys: [
                {
                    key: " ",
                    modifiers: ["Mod"]
                }
            ],
            editorCallback: (editor) => {
                //This is the same function that is called by obsidian when you type a character
                (this.suggestionPopup as any).trigger(editor, this.app.workspace.getActiveFile(), true);
            }
        })

        //TODO: Settings
        // - Customize "rainbow" colors for nested snippets
    }

    async onunload() {
        this.app.workspace.iterateCodeMirrors((cm) => {
            cm.off('keydown', this.handleKeydown);
            cm.off('beforeChange', this.handleBeforeChange);
            cm.off('cursorActivity', this.handleCursorActivity);
        })

        this.app.workspace.off('file-open', this.onFileOpened);

        this.snippetManager.onunload();
        await FileScanner.saveData(this.app.vault);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        await WordList.loadFromFiles(this.settings);
        await FileScanner.loadData(this.app.vault);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private readonly onFileOpened = (file: TFile) => {
        if (!this.settings.fileScannerScanCurrent)
            return;

        FileScanner.scanFile(this.settings, file, true);
    }

    private readonly handleBeforeChange = () => {
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
        const placeholder = this.snippetManager.placeholderAtPos(editor, editor.getCursor());

        //Pass through enter and tab when holding shift. Allows going to the next line while the popup is open
        if (event.shiftKey) {
            this.suggestionPopup.close();
            if (!placeholder) {
                //Hack: Dispatch the event again to properly continue lists and other obsidian formatting features.
                let keyboardEvent = new KeyboardEvent(event.type, {
                    key: event.key,
                    altKey: event.altKey,
                    keyCode: event.keyCode,
                    charCode: event.charCode
                });
                cm.getInputField().dispatchEvent(keyboardEvent);
                event.preventDefault();
            }
        }

        if (!placeholder)
            return;
        const placeholderEnd = (placeholder.marker.find() as MarkerRange).to;

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
