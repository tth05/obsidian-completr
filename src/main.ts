import {EditorPosition, editorViewField, KeymapContext, MarkdownView, Plugin, TFile,} from "obsidian";
import SnippetManager from "./snippet_manager";
import SuggestionPopup, {SelectionDirection} from "./popup";
import {CompletrSettings, DEFAULT_SETTINGS} from "./settings";
import {WordList} from "./provider/word_list_provider";
import {FileScanner} from "./provider/scanner_provider";
import CompletrSettingsTab from "./settings_tab";
import {EditorView, ViewUpdate} from "@codemirror/view";
import {Prec} from "@codemirror/state";
import {editorToCodeMirrorState, posFromIndex} from "./editor_helpers";
import {markerStateField} from "./marker_state_field";
import {FrontMatter} from "./provider/front_matter_provider";
import {Latex} from "./provider/latex_provider";

export default class CompletrPlugin extends Plugin {

    settings: CompletrSettings;

    private snippetManager: SnippetManager;
    private _suggestionPopup: SuggestionPopup;

    async onload() {
        await this.loadSettings();

        this.snippetManager = new SnippetManager();
        this._suggestionPopup = new SuggestionPopup(this.app, this.settings, this.snippetManager);

        this.registerEditorSuggest(this._suggestionPopup);

        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpened, this));
        this.registerEvent(this.app.metadataCache.on('changed', FrontMatter.onCacheChange, FrontMatter));
        this.app.workspace.onLayoutReady(() => FrontMatter.loadYAMLKeyCompletions(this.app.metadataCache, this.app.vault.getMarkdownFiles()));

        this.registerEditorExtension(markerStateField);
        this.registerEditorExtension(EditorView.updateListener.of(new CursorActivityListener(this.snippetManager, this._suggestionPopup).listener));

        this.addSettingTab(new CompletrSettingsTab(this.app, this));

        this.setupCommands();

        if ((this.app.vault as any).config?.legacyEditor) {
            console.log("Completr: Without Live Preview enabled, most features of Completr will not work properly!");
        }
    }

    private setupCommands() {
        //This replaces the default handler for commands. This is needed because the default handler always consumes
        // the event if the command exists.
        const app = this.app as any;
        app.scope.keys = [];

        const isHotkeyMatch = (hotkey: any, context: KeymapContext, id: string): boolean => {
            //Copied from original isMatch function, modified to not require exactly the same modifiers for
            // completr-bypass commands. This allows triggering for example Ctrl+Enter even when
            // pressing Ctrl+Shift+Enter. The additional modifier is then passed to the editor.

            /* Original isMatch function:
            var n = e.modifiers
                , i = e.key;
            return (null === n || n === t.modifiers) && (!i || (i === t.vkey || !(!t.key || i.toLowerCase() !== t.key.toLowerCase())))
            */

            const modifiers = hotkey.modifiers, key = hotkey.key;
            if (modifiers !== null && (id.contains("completr-bypass") ? !context.modifiers.contains(modifiers) : modifiers !== context.modifiers))
                return false;
            return (!key || (key === context.vkey || !(!context.key || key.toLowerCase() !== context.key.toLowerCase())))
        }
        this.app.scope.register(null, null, (e: KeyboardEvent, t: KeymapContext) => {
            const hotkeyManager = app.hotkeyManager;
            hotkeyManager.bake();
            for (let bakedHotkeys = hotkeyManager.bakedHotkeys, bakedIds = hotkeyManager.bakedIds, r = 0; r < bakedHotkeys.length; r++) {
                const hotkey = bakedHotkeys[r];
                const id = bakedIds[r];
                if (isHotkeyMatch(hotkey, t, id)) {
                    const command = app.commands.findCommand(id);

                    //HACK: Hide our commands when to popup is not visible to allow the keybinds to execute their default action.
                    if (!command || (command.isVisible && !command.isVisible())) {
                        continue;
                    } else if (id.contains("completr-bypass")) {
                        this._suggestionPopup.close();

                        const validMods = t.modifiers.replace(new RegExp(`${hotkey.modifiers},*`), "").split(",");
                        //Sends the event again, only keeping the modifiers which didn't activate this command
                        let event = new KeyboardEvent("keydown", {
                            key: hotkeyManager.defaultKeys[id][0].key,
                            ctrlKey: validMods.contains("Ctrl"),
                            shiftKey: validMods.contains("Shift"),
                            altKey: validMods.contains("Alt"),
                            metaKey: validMods.contains("Meta")
                        });
                        e.target.dispatchEvent(event);
                        return false;
                    }

                    if (app.commands.executeCommandById(id))
                        return false
                }
            }
        });

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
                (this._suggestionPopup as any).trigger(editor, this.app.workspace.getActiveFile(), true);
            },
        });
        this.addCommand({
            id: 'completr-select-next-suggestion',
            name: 'Select next suggestion',
            hotkeys: [
                {
                    key: "ArrowDown",
                    modifiers: []
                }
            ],
            editorCallback: (editor) => {
                this.suggestionPopup.selectNextItem(SelectionDirection.NEXT);
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-select-previous-suggestion',
            name: 'Select previous suggestion',
            hotkeys: [
                {
                    key: "ArrowUp",
                    modifiers: []
                }
            ],
            editorCallback: (editor) => {
                this.suggestionPopup.selectNextItem(SelectionDirection.PREVIOUS);
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-insert-selected-suggestion',
            name: 'Insert selected suggestion',
            hotkeys: [
                {
                    key: "Enter",
                    modifiers: []
                }
            ],
            editorCallback: (editor) => {
                this.suggestionPopup.applySelectedItem();
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-bypass-enter-key',
            name: 'Bypass the popup and press Enter',
            hotkeys: [
                {
                    key: "Enter",
                    modifiers: ["Ctrl"]
                }
            ],
            editorCallback: (editor) => {
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-bypass-tab-key',
            name: 'Bypass the popup and press Tab',
            hotkeys: [
                {
                    key: "Tab",
                    modifiers: ["Ctrl"]
                }
            ],
            editorCallback: (editor) => {
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-close-suggestion-popup',
            name: 'Close suggestion popup',
            hotkeys: [
                {
                    key: "Escape",
                    modifiers: []
                }
            ],
            editorCallback: (editor) => {
                this.suggestionPopup.close();
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-jump-to-next-snippet-placeholder',
            name: 'Jump to next snippet placeholder',
            hotkeys: [
                {
                    key: "Enter",
                    modifiers: []
                }
            ],
            editorCallback: (editor, view) => {
                const placeholder = this.snippetManager.placeholderAtPos(editor.getCursor());
                //Sanity check
                if (!placeholder)
                    return;
                const placeholderEnd = posFromIndex(editorToCodeMirrorState(placeholder.editor).doc, placeholder.marker.to);

                if (!this.snippetManager.consumeAndGotoNextMarker(editor)) {
                    editor.setSelections([{
                        anchor: {
                            ...placeholderEnd,
                            ch: Math.min(editor.getLine(placeholderEnd.line).length, placeholderEnd.ch + 1)
                        }
                    }]);
                }
            },
            // @ts-ignore
            isVisible: () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view)
                    return false;
                const placeholder = this.snippetManager.placeholderAtPos(view.editor.getCursor());
                return placeholder != null;
            },
        });
    }

    async onunload() {
        this.snippetManager.onunload();
        await FileScanner.saveData(this.app.vault);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        WordList.loadFromFiles(this.app.vault, this.settings);
        FileScanner.loadData(this.app.vault);
        Latex.loadCommands(this.app.vault);
    }

    get suggestionPopup() {
        return this._suggestionPopup;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private readonly onFileOpened = (file: TFile) => {
        if (!this.settings.fileScannerScanCurrent || !file)
            return;

        FileScanner.scanFile(this.settings, file, true);
    }
}

class CursorActivityListener {

    private readonly snippetManager: SnippetManager;
    private readonly suggestionPopup: SuggestionPopup;

    private cursorTriggeredByChange = false;
    private lastCursorLine = -1;

    constructor(snippetManager: SnippetManager, suggestionPopup: SuggestionPopup) {
        this.snippetManager = snippetManager;
        this.suggestionPopup = suggestionPopup;
    }

    readonly listener = (update: ViewUpdate) => {
        if (update.docChanged) {
            this.handleDocChange();
        }

        if (update.selectionSet) {
            this.handleCursorActivity(posFromIndex(update.state.doc, update.state.selection.main.head))
        }
    };

    private readonly handleDocChange = () => {
        this.cursorTriggeredByChange = true;
    };

    private readonly handleCursorActivity = (cursor: EditorPosition) => {
        //This prevents the popup from opening when switching to the previous line
        if (this.lastCursorLine == cursor.line + 1)
            this.suggestionPopup.preventNextTrigger();
        this.lastCursorLine = cursor.line;

        //Clear all placeholders when moving cursor outside of them
        if (!this.snippetManager.placeholderAtPos(cursor)) {
            this.snippetManager.clearAllPlaceholders();
        }

        //Prevents the suggestion popup from flickering when typing
        if (this.cursorTriggeredByChange) {
            this.cursorTriggeredByChange = false;
            return;
        }

        this.suggestionPopup.close();
    };
}
