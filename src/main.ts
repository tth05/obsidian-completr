import { EditorView } from "@codemirror/view";
import { type Editor, Notice, Plugin, TFile } from "obsidian";
import { DataFiles } from "./data_files.ts";
import { reportError } from "./errors.ts";
import { InlineSuggestions } from "./inline_suggestions.ts";
import { createKeymap, registerCommands } from "./keybindings.ts";
import { SuggestionPopup } from "./popup.ts";
import { SuggestionBlacklist } from "./provider/blacklist.ts";
import { CalloutProvider } from "./provider/callout_provider.ts";
import { FrontMatterProvider } from "./provider/front_matter_provider.ts";
import { LatexProvider } from "./provider/latex_provider.ts";
import type { SuggestionProvider } from "./provider/provider.ts";
import { FileScannerProvider } from "./provider/scanner_provider.ts";
import { SnippetProvider } from "./provider/snippet_provider.ts";
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
    snippets!: SnippetProvider;
    fileScanner!: FileScannerProvider;
    wordList!: WordListProvider;
    /** In priority order. */
    providers!: SuggestionProvider[];

    popup!: SuggestionPopup;
    inlineSuggestions!: InlineSuggestions;
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
        this.callout = new CalloutProvider(this, this.files);
        this.latex = new LatexProvider(this.files, this.blacklist);
        this.snippets = new SnippetProvider(this.files);
        this.fileScanner = new FileScannerProvider(this.files);
        this.wordList = new WordListProvider(this.files);
        this.providers = [this.frontMatter, this.callout, this.snippets, this.latex, this.fileScanner, this.wordList];

        this.inlineSuggestions = new InlineSuggestions(this);
        this.popup = new SuggestionPopup(this.app, this);
        registerCommands(this);
        this.registerEditorExtension([
            snippetExtension,
            this.inlineSuggestions.extension,
            createKeymap(this),
            EditorView.updateListener.of((update) => this.popup.onEditorUpdate(update)),
        ]);
        this.addSettingTab(new CompletrSettingsTab(this.app, this));

        this.loaded = new Promise((resolve) => {
            this.app.workspace.onLayoutReady(async () => {
                // Registered late, so that the suggests of Obsidian and other plugins get the first chance to trigger.
                this.registerEditorSuggest(this.popup);
                await this.loadDataFiles();
                this.registerEvents();
                resolve();
            });
        });
    }

    override onunload() {
        this.callout.unload();
        this.fileScanner.flush().catch(reportError);
        this.usage.flush().catch(reportError);
    }

    /** Loads everything the providers need. One broken file must not keep the rest from working. */
    private async loadDataFiles() {
        const load = async (what: string, run: () => Promise<unknown> | void) => {
            try {
                // Loaders return a message if they could recover from a problem (e.g. an invalid file)
                const problem = await run();
                if (typeof problem === "string") new Notice("Completr: " + problem, 8000);
            } catch (e) {
                console.error(`Completr: Unable to load ${what}`, e);
                new Notice(`Completr: Unable to load ${what}. See the developer console for details.`, 8000);
            }
        };

        // First, the LaTeX commands may add to it
        await load("the blacklist", () => this.blacklist.load());
        await Promise.all([
            load("the LaTeX commands", () => this.latex.load()),
            load("the snippets", () => this.snippets.load()),
            load("the callouts", () => this.callout.load(this.settings)),
            load("the word lists", () => this.wordList.load(this.settings)),
            load("the scanned words", () => this.fileScanner.load(this.settings)),
            load("the usage counts", () => this.usage.load()),
            load("the front matter", () => {
                this.frontMatter.loadAll(this.app.metadataCache, this.app.vault.getMarkdownFiles());
            }),
        ]);

        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) this.scanEditor(editor, false);
    }

    private registerEvents() {
        const { metadataCache, vault, workspace } = this.app;
        this.registerEvent(metadataCache.on("changed", (file, _, cache) => this.frontMatter.updateFile(file, cache)));
        this.registerEvent(vault.on("delete", (file) => this.frontMatter.removeFile(file.path)));
        this.registerEvent(vault.on("rename", (file, oldPath) => this.frontMatter.renameFile(oldPath, file.path)));

        this.registerEvent(
            workspace.on("file-open", (file) => {
                // Only notes have words to learn, not PDFs, images or canvases
                if (!(file instanceof TFile) || file.extension !== "md") return;
                // The editor of a new tab or split is still empty at this point, the vault has the text
                vault
                    .cachedRead(file)
                    .then((text) => this.fileScanner.setCurrentFileText(text, this.settings))
                    .catch(reportError);
            }),
        );

        // Not Obsidian's debounce: with resetTimer, it keeps waiting for a timer of the window that was active when it
        // started. If that was a popout window that is closed in the meantime, the timer never fires and the words
        // of the note being edited are never learned again.
        let scanTimer: number | undefined;
        this.register(() => window.clearTimeout(scanTimer));
        this.registerEvent(
            workspace.on("editor-change", (editor) => {
                window.clearTimeout(scanTimer);
                scanTimer = window.setTimeout(() => this.scanEditor(editor, true), SCAN_DELAY_MS);
            }),
        );
    }

    /**
     * Picks up the words of the note being edited.
     * @param editing skip the word at the cursor, which might still be typed
     */
    private scanEditor(editor: Editor, editing: boolean) {
        this.fileScanner.setCurrentFileText(
            editor.getValue(),
            this.settings,
            editing ? editor.posToOffset(editor.getCursor()) : -1,
        );
    }

    /** Learns the words of all notes. */
    async scanVault() {
        const notice = new Notice("Completr: Scanning all notes...", 0);
        try {
            const files = this.app.vault.getMarkdownFiles();
            const scanned = await this.fileScanner.scanFiles(this.app.vault, files, this.settings);
            new Notice(`Completr: Scanned ${scanned} notes, ${this.fileScanner.wordCount} known words`);
        } finally {
            notice.hide();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /** Hides a suggestion everywhere. */
    async blacklistSuggestion(displayName: string) {
        await this.blacklist.add(displayName);
        this.popup.refresh();
    }
}
