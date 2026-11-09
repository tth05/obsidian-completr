import { EditorView } from "@codemirror/view";
import { debounce, type Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DataFiles } from "./data_files.ts";
import { createKeymap, registerCommands } from "./keybindings.ts";
import { SuggestionPopup } from "./popup.ts";
import { SuggestionBlacklist } from "./provider/blacklist.ts";
import { CalloutProvider } from "./provider/callout_provider.ts";
import { FrontMatterProvider } from "./provider/front_matter_provider.ts";
import { LatexProvider } from "./provider/latex_provider.ts";
import type { SuggestionProvider } from "./provider/provider.ts";
import { FileScannerProvider } from "./provider/scanner_provider.ts";
import { WordListProvider } from "./provider/word_list_provider.ts";
import { type CompletrSettings, loadSettings } from "./settings.ts";
import CompletrSettingsTab from "./settings_tab.ts";
import { snippetExtension } from "./snippets.ts";
import { SuggestionUsage } from "./usage.ts";

/** How long to wait after the last edit before scanning the active note for new words. */
const SCAN_DELAY_MS = 1000;

export default class CompletrPlugin extends Plugin {
    declare settings: CompletrSettings;

    files!: DataFiles;
    blacklist!: SuggestionBlacklist;
    usage!: SuggestionUsage;

    frontMatter!: FrontMatterProvider;
    callout!: CalloutProvider;
    latex!: LatexProvider;
    fileScanner!: FileScannerProvider;
    wordList!: WordListProvider;
    /** In priority order. */
    providers!: SuggestionProvider[];

    popup!: SuggestionPopup;
    /** Resolves once all data files are loaded. */
    loaded!: Promise<void>;

    override async onload() {
        const { settings, migratedFrom } = loadSettings(await this.loadData());
        this.settings = settings;
        if (migratedFrom !== null) await this.saveSettings();

        this.files = new DataFiles(
            this.app.vault.adapter,
            this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
        );
        this.blacklist = new SuggestionBlacklist(this.files);
        this.usage = new SuggestionUsage(this.files);
        this.frontMatter = new FrontMatterProvider();
        this.callout = new CalloutProvider(this, this.files, this.blacklist);
        this.latex = new LatexProvider(this.files, this.blacklist);
        this.fileScanner = new FileScannerProvider(this.files, this.blacklist);
        this.wordList = new WordListProvider(this.files, this.blacklist);
        this.providers = [this.frontMatter, this.callout, this.latex, this.fileScanner, this.wordList];

        this.popup = new SuggestionPopup(this.app, this);
        registerCommands(this);
        this.registerEditorExtension([
            snippetExtension,
            createKeymap(this),
            EditorView.updateListener.of((update) => this.popup.onEditorUpdate(update)),
        ]);
        this.addSettingTab(new CompletrSettingsTab(this.app, this));

        this.loaded = new Promise((resolve) => {
            this.app.workspace.onLayoutReady(async () => {
                // Registered late, so that the suggests of Obsidian and other plugins get the first chance to trigger.
                this.registerEditorSuggest(this.popup);
                await this.loadDataFiles(migratedFrom);
                this.registerEvents();
                resolve();
            });
        });
    }

    override onunload() {
        this.callout.unload();
        void this.fileScanner.flush();
        void this.usage.flush();
    }

    private async loadDataFiles(migratedFrom: number | null) {
        await this.blacklist.load();
        const errors = await Promise.all([
            this.latex.load(migratedFrom === 1),
            this.callout.load(this.settings),
            this.wordList.load(this.settings).then(() => null),
            this.fileScanner.load(this.settings).then(() => null),
            this.usage.load().then(() => null),
        ]);
        for (const error of errors) if (error) new Notice("Completr: " + error, 8000);

        const { metadataCache, vault } = this.app;
        this.frontMatter.loadAll(metadataCache, vault.getMarkdownFiles());
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) this.scanEditor(editor);
    }

    private registerEvents() {
        const { metadataCache, vault, workspace } = this.app;
        this.registerEvent(metadataCache.on("changed", (file, _, cache) => this.frontMatter.updateFile(file, cache)));
        this.registerEvent(vault.on("delete", (file) => this.frontMatter.removeFile(file.path)));
        this.registerEvent(vault.on("rename", (file, oldPath) => this.frontMatter.renameFile(oldPath, file.path)));

        this.registerEvent(
            workspace.on("file-open", (file) => {
                if (!(file instanceof TFile)) return;
                const editor = workspace.getActiveViewOfType(MarkdownView)?.editor;
                if (editor) this.scanEditor(editor);
                else
                    void vault
                        .cachedRead(file)
                        .then((text) => this.fileScanner.setCurrentFileText(text, this.settings));
            }),
        );

        const scanLater = debounce((editor: Editor) => this.scanEditor(editor), SCAN_DELAY_MS, true);
        this.registerEvent(workspace.on("editor-change", (editor) => scanLater(editor)));
    }

    /** Picks up the words of the note being edited, except the one at the cursor which might be incomplete. */
    private scanEditor(editor: Editor) {
        if (!this.settings.fileScannerProviderEnabled) return;
        this.fileScanner.setCurrentFileText(editor.getValue(), this.settings, editor.posToOffset(editor.getCursor()));
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getProviderIcon(providerId: string | undefined): string | undefined {
        return this.providers.find((p) => p.id === providerId)?.icon;
    }

    /** Hides a suggestion everywhere and forgets it as a scanned word. */
    async blacklistSuggestion(displayName: string) {
        await this.blacklist.add(displayName);
        this.fileScanner.removeWord(displayName);
        this.wordList.removeWord(displayName);
        this.latex.rebuildIndex();
        this.popup.refresh();
    }
}
