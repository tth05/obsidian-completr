import { EditorPosition, KeymapContext, MarkdownView, Plugin, TFile, } from "obsidian";
import SnippetManager from "./snippet_manager";
import SuggestionPopup, { SelectionDirection } from "./popup";
import { CompletrSettings, DEFAULT_SETTINGS } from "./settings";
import { WordList } from "./provider/word_list_provider";
import { FileScanner } from "./provider/scanner_provider";
import CompletrSettingsTab from "./settings_tab";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { editorToCodeMirrorState, posFromIndex } from "./editor_helpers";
import { markerStateField } from "./marker_state_field";
import { FrontMatter } from "./provider/front_matter_provider";
import { Latex } from "./provider/latex_provider";
import { Callout } from "./provider/callout_provider";
import { SuggestionBlacklist } from "./provider/blacklist";

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

        const isHotkeyMatch = (hotkey: any, context: KeymapContext, isBypassCommand: boolean): boolean => {
            //Copied from original isMatch function, modified to not require exactly the same modifiers for
            // completr-bypass commands. This allows triggering for example Ctrl+Enter even when
            // pressing Ctrl+Shift+Enter. The additional modifier is then passed to the editor.

            /* Original isMatch function:
            var n = e.modifiers
                , i = e.key;
            return (null === n || n === t.modifiers) && (!i || (i === t.vkey || !(!t.key || i.toLowerCase() !== t.key.toLowerCase())))
            */

            const modifiers = hotkey.modifiers, key = hotkey.key;
            if (modifiers !== null && (isBypassCommand ? !context.modifiers.contains(modifiers) : modifiers !== context.modifiers))
                return false;
            return (!key || (key === context.vkey || !(!context.key || key.toLowerCase() !== context.key.toLowerCase())))
        }
        this.app.scope.register(null, null, (e: KeyboardEvent, t: KeymapContext) => {
            const hotkeyManager = app.hotkeyManager;
            hotkeyManager.bake();
            for (let bakedHotkeys = hotkeyManager.bakedHotkeys, bakedIds = hotkeyManager.bakedIds, r = 0; r < bakedHotkeys.length; r++) {
                const hotkey = bakedHotkeys[r];
                const id = bakedIds[r];
                const command = app.commands.findCommand(id);
                const isBypassCommand = command?.isBypassCommand?.();
                if (isHotkeyMatch(hotkey, t, isBypassCommand)) {
                    // Condition taken from original function
                    if (!command || (e.repeat && !command.repeatable)) {
                        continue;
                    } else if (command.isVisible && !command.isVisible()) {
                        //HACK: Hide our commands when to popup is not visible to allow the keybinds to execute their default action.
                        continue;
                    } else if (isBypassCommand) {
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
                // This is the same function that is called by obsidian when you type a character
                (this._suggestionPopup as any).trigger(editor, /* Passing null here is a signal that this was triggered manually by the user */ null, true);
            },
            // @ts-ignore
            isVisible: () => !this._suggestionPopup.isVisible()
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
            repeatable: true,
            editorCallback: (_) => {
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
            repeatable: true,
            editorCallback: (_) => {
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
            editorCallback: (_) => this.suggestionPopup.applySelectedItem(),
            // @ts-ignore
            isBypassCommand: () => !this._suggestionPopup.isFocused(),
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
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
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
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-blacklist-current-word',
            name: 'Add the currently selected word to the blacklist',
            hotkeys: [
                {
                    key: "D",
                    modifiers: ["Shift"]
                }
            ],
            editorCallback: (editor) => {
                SuggestionBlacklist.add(this._suggestionPopup.getSelectedItem());
                SuggestionBlacklist.saveData(this.app.vault);
                (this._suggestionPopup as any).trigger(editor, this.app.workspace.getActiveFile(), true);
            },
            // @ts-ignore
            isBypassCommand: () => !this._suggestionPopup.isFocused(),
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
            editorCallback: (_) => this.suggestionPopup.close(),
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
            editorCallback: (editor, _) => {
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

        // Here are some notes about this command and the isBypassCommand function:
        // - This command is registered last so that other hotkeys can be bound to tab without being overridden
        // - The isBypassCommand function exists, because obsidian has editor suggest related event handlers for Enter,
        //   Tab, ArrowUp and ArrowDown which completely prevent those keys from getting to the editor while an editor
        //   suggest is open. This function bypasses that using the custom hotkey hook above which will dispatch an
        //   event to the editor if the isBypassCommand function returns true.
        // - All of this restores the default behavior for all keys while the suggestion popup is open, but not focused.
        this.addCommand({
            id: 'completr-fake-tab',
            name: '(internal)',
            hotkeys: [
                {
                    key: "Tab",
                    modifiers: []
                }
            ],
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-fake-enter',
            name: '(internal)',
            hotkeys: [
                {
                    key: "Enter",
                    modifiers: []
                }
            ],
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-fake-arrow-up',
            name: '(internal)',
            hotkeys: [
                {
                    key: "ArrowUp",
                    modifiers: []
                }
            ],
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
            isVisible: () => this._suggestionPopup.isVisible(),
        });
        this.addCommand({
            id: 'completr-fake-arrow-down',
            name: '(internal)',
            hotkeys: [
                {
                    key: "ArrowDown",
                    modifiers: []
                }
            ],
            editorCallback: (_) => {
            },
            // @ts-ignore
            isBypassCommand: () => true,
            isVisible: () => this._suggestionPopup.isVisible(),
        });
    }

    async onunload() {
        this.snippetManager.onunload();
        await FileScanner.saveData(this.app.vault);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        SuggestionBlacklist.loadData(this.app.vault).then(() => {
            WordList.loadFromFiles(this.app.vault, this.settings);
            FileScanner.loadData(this.app.vault);
            Latex.loadCommands(this.app.vault);
            Callout.loadSuggestions(this.app.vault, this);
        });
    }

    get suggestionPopup() {
        return this._suggestionPopup;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private readonly onFileOpened = (file: TFile) => {
        if (!this.settings.fileScannerProviderEnabled || !this.settings.fileScannerScanCurrent || !file)
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
        // This prevents the popup from opening when switching to the previous line
        const didChangeLine = this.lastCursorLine != cursor.line;
        if (didChangeLine)
            this.suggestionPopup.preventNextTrigger();
        this.lastCursorLine = cursor.line;

        // Clear all placeholders when moving cursor somewhere else
        if (!this.snippetManager.placeholderAtPos(cursor)) {
            this.snippetManager.clearAllPlaceholders();
        }

        // Prevents the suggestion popup from flickering when typing
        if (this.cursorTriggeredByChange) {
            this.cursorTriggeredByChange = false;
            if (!didChangeLine)
                return;
        }

        this.suggestionPopup.close();
    };
}
