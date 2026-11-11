import { type App, Notice, PluginSettingTab, SettingGroup, type TextComponent } from "obsidian";
import { isInstalled as isCalloutManagerInstalled } from "obsidian-callout-manager";
import { decodeText } from "./data_files.ts";
import { guarded } from "./errors.ts";
import { BLACKLIST_COMMAND, getHotkeyLabel, OPEN_POPUP_COMMAND } from "./hotkeys.ts";
import type CompletrPlugin from "./main.ts";
import { ConfirmationModal, CustomEntryModal, ListModal, openCustomEntryList } from "./modals.ts";
import type { CustomEntryFile } from "./provider/custom_suggestions.ts";
import { CalloutProviderSource, type CompletrSettings, IconMode, SortOrder, WordInsertionMode } from "./settings.ts";
import { compileCharacterClass } from "./text.ts";

type BooleanKey = {
    [K in keyof CompletrSettings]: CompletrSettings[K] extends boolean ? K : never;
}[keyof CompletrSettings];
type NumberKey = {
    [K in keyof CompletrSettings]: CompletrSettings[K] extends number ? K : never;
}[keyof CompletrSettings];

const plural = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

export default class CompletrSettingsTab extends PluginSettingTab {
    /** The running reload of the word lists, so that reloads never overlap. */
    private wordListReload: Promise<unknown> = Promise.resolve();

    constructor(
        app: App,
        private readonly plugin: CompletrPlugin,
    ) {
        super(app, plugin);
    }

    private get settings() {
        return this.plugin.settings;
    }

    private async save() {
        await this.plugin.saveSettings();
    }

    /** E.g. "Ctrl+Space", or how to get one if the command has no hotkey. */
    private hotkey(commandId: string): string {
        return getHotkeyLabel(this.plugin, commandId) ?? "a hotkey you assign";
    }

    // ---- Setting builders -------------------------------------------------------------------------------------------

    private toggle(group: SettingGroup, key: BooleanKey, name: string, desc: string, onChange?: () => unknown) {
        group.addSetting((s) =>
            s
                .setName(name)
                .setDesc(desc)
                .addToggle((t) =>
                    t.setValue(this.settings[key]).onChange(
                        guarded(async (value: boolean) => {
                            this.settings[key] = value;
                            await this.save();
                            await onChange?.();
                        }),
                    ),
                ),
        );
    }

    private number(group: SettingGroup, key: NumberKey, name: string, desc: string, min = 0) {
        group.addSetting((s) =>
            s
                .setName(name)
                .setDesc(desc)
                .addText((text) => {
                    text.inputEl.type = "number";
                    text.inputEl.min = String(min);
                    text.setValue(String(this.settings[key])).onChange(async (value) => {
                        const parsed = parseInt(value);
                        if (isNaN(parsed) || parsed < min) return;
                        this.settings[key] = parsed;
                        await this.save();
                    });
                }),
        );
    }

    private dropdown<K extends keyof CompletrSettings>(
        group: SettingGroup,
        key: K,
        name: string,
        desc: string,
        options: Record<string, string>,
        onChange?: () => unknown,
    ) {
        group.addSetting((s) =>
            s
                .setName(name)
                .setDesc(desc)
                .addDropdown((d) =>
                    d
                        .addOptions(options)
                        .setValue(String(this.settings[key]))
                        .onChange(
                            guarded(async (value: string) => {
                                (this.settings as unknown as Record<string, unknown>)[key] = value;
                                await this.save();
                                await onChange?.();
                            }),
                        ),
                ),
        );
    }

    /** The count of a list of custom entries (custom LaTeX commands, snippets), with buttons to manage and add them. */
    private customEntries(group: SettingGroup, file: CustomEntryFile) {
        const refresh = () => this.display();
        group.addSetting((s) =>
            s
                .setName(file.countLabel)
                .setDesc(file.error ?? file.kind.description)
                .addButton((b) => b.setButtonText("Manage").onClick(() => openCustomEntryList(this.app, file, refresh)))
                .addButton((b) =>
                    b
                        .setButtonText(file.kind.addTitle)
                        .setCta()
                        .onClick(() => new CustomEntryModal(this.app, file, { onDone: refresh }).open()),
                ),
        );
    }

    // ---- Display ------------------------------------------------------------------------------------------------

    override display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.displayGeneral(containerEl);
        this.displayWords(containerEl);
        this.displayFileScanner(containerEl);
        this.displayWordLists(containerEl);
        this.displayLatex(containerEl);
        this.displaySnippets(containerEl);
        this.displayFrontMatter(containerEl);
        this.displayCallouts(containerEl);
        this.displayBlacklist(containerEl);
    }

    private displayGeneral(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl);
        this.toggle(
            group,
            "autoTrigger",
            "Open automatically",
            `Open the popup while typing. Otherwise use the "Open suggestion popup" command (${this.hotkey(OPEN_POPUP_COMMAND)}). Can be toggled with a command.`,
        );
        this.toggle(
            group,
            "inlineSuggestions",
            "Inline suggestions",
            "Show the best suggestion as grey text after the cursor while typing. Tab inserts it, Escape hides it. While the popup is open, it shows the selected suggestion.",
            () => {
                if (!this.settings.inlineSuggestions) this.plugin.inlineSuggestions.dismissAll();
            },
        );
        this.toggle(
            group,
            "autoFocus",
            "Select first suggestion",
            "Select the first suggestion when the popup opens, so Enter inserts it. Otherwise Enter starts a new line until a suggestion is selected with the arrow keys.",
        );
        this.toggle(
            group,
            "insertWithTab",
            "Insert with Tab",
            'Tab inserts the selected suggestion, in addition to the "Insert selected suggestion" hotkey (Enter by default).',
        );
        this.toggle(
            group,
            "jumpWithTab",
            "Jump to next placeholder with Tab",
            'Tab moves to the next snippet placeholder, in addition to the "Jump to next snippet placeholder" hotkey (Enter by default).',
        );
        this.dropdown(group, "iconMode", "Icons", "Which icons to show next to suggestions.", {
            [IconMode.SUGGESTION]: "Only for suggestions with their own icon (callouts)",
            [IconMode.SUGGESTION_OR_PROVIDER]: "Show where each suggestion comes from",
            [IconMode.NONE]: "None",
        });
        group.addSetting((s) =>
            s
                .setName("Rank by usage")
                .setDesc("Suggestions you insert often are listed first.")
                .addExtraButton((b) =>
                    b
                        .setIcon("rotate-ccw")
                        .setTooltip("Forget how often suggestions were used")
                        .onClick(
                            guarded(async () => {
                                await this.plugin.usage.clear();
                                new Notice("Completr: Usage counts were reset");
                            }),
                        ),
                )
                .addToggle((t) =>
                    t.setValue(this.settings.rankByUsage).onChange(
                        guarded(async (value: boolean) => {
                            this.settings.rankByUsage = value;
                            await this.save();
                        }),
                    ),
                ),
        );
        group.addSetting((s) =>
            s
                .setName("Hotkeys")
                .setDesc(
                    "All keys used in the popup (arrows, Enter, Escape, ...) are commands and can be changed in the hotkey settings.",
                )
                .addButton((b) =>
                    b
                        .setButtonText("Open hotkeys")
                        .onClick(() => this.app.setting.openTabById("hotkeys")?.setQuery?.(this.plugin.manifest.id)),
                ),
        );
    }

    private displayWords(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("Words");
        group.addSetting((s) =>
            s
                .setName("Word characters")
                .setDesc(
                    "The characters a word consists of, as the content of a regex character class. The default \\p{L}\\p{M} matches letters of all languages. Add e.g. 0-9 for numbers, or - and _.",
                )
                .addText((text: TextComponent) =>
                    text.setValue(this.settings.characterRegex).onChange(async (value) => {
                        const valid = value.length > 0 && compileCharacterClass(value) !== null;
                        text.inputEl.toggleClass("completr-settings-error", !valid);
                        if (!valid) return;
                        this.settings.characterRegex = value;
                        await this.save();
                    }),
                ),
        );
        this.number(
            group,
            "minWordLength",
            "Minimum word length",
            "Shorter words are never suggested by the file scanner and word lists.",
            1,
        );
        this.number(
            group,
            "minWordTriggerLength",
            "Minimum typed length",
            "How many characters have to be typed before word suggestions appear. Opening the popup manually ignores this.",
            1,
        );
        this.number(
            group,
            "maxLookBackDistance",
            "Maximum word length",
            "How far back from the cursor to look for the start of the word that is being typed.",
            1,
        );
        this.dropdown(
            group,
            "wordInsertionMode",
            "Matching and insertion",
            "What happens when you type 'hel' and 'Hello' is a known word.",
            {
                [WordInsertionMode.IGNORE_CASE_REPLACE]: "Ignore case, insert the known word: 'Hello'",
                [WordInsertionMode.IGNORE_CASE_APPEND]: "Ignore case, keep what I typed: 'hello'",
                [WordInsertionMode.MATCH_CASE_REPLACE]: "Match case: 'Hello' is not suggested",
            },
        );
        this.toggle(
            group,
            "ignoreDiacriticsWhenFiltering",
            "Ignore diacritics",
            "Typing 'Hello' also suggests 'Hèllò'.",
        );
        this.toggle(
            group,
            "fuzzyMatching",
            "Fuzzy matching",
            "Also suggest words that contain the typed characters in order, e.g. 'mkd' suggests 'markdown'. These are listed after words that start with the typed text.",
        );
        this.dropdown(
            group,
            "sortOrder",
            "Sort order",
            "How word suggestions are ordered.",
            {
                [SortOrder.SHORTEST_FIRST]: "Shortest first",
                [SortOrder.LONGEST_FIRST]: "Longest first",
                [SortOrder.ALPHABETICAL]: "Alphabetical",
            },
            // Shows or hides the sorting language
            () => this.display(),
        );
        if (this.settings.sortOrder === SortOrder.ALPHABETICAL)
            group.addSetting((s) =>
                s
                    .setName("Sorting language")
                    .setDesc(
                        "Language used for alphabetical sorting, e.g. 'de' or 'sv'. Leave empty to use Obsidian's language.",
                    )
                    .addText((t) =>
                        t
                            .setPlaceholder("Obsidian's language")
                            .setValue(this.settings.sortLocale)
                            .onChange(async (value) => {
                                this.settings.sortLocale = value.trim();
                                await this.save();
                            }),
                    ),
            );
        this.toggle(group, "insertSpaceAfterWord", "Add space after words", "Insert a space after a completed word.");
        this.toggle(
            group,
            "disableWordsInCode",
            "No words in code",
            "Don't suggest words inside code blocks and inline code.",
        );
    }

    private displayFileScanner(containerEl: HTMLElement) {
        const { fileScanner } = this.plugin;
        const group = new SettingGroup(containerEl).setHeading("File scanner");
        this.toggle(group, "fileScannerProviderEnabled", "Enabled", "Suggest words that appear in your notes.");
        this.toggle(
            group,
            "fileScannerScanCurrent",
            "Learn words while writing",
            "Remember the words of every note you open or edit.",
        );
        this.toggle(
            group,
            "fileScannerCurrentFileOnly",
            "Only words from the current note",
            "Only suggest words that appear in the note you're editing.",
        );
        group.addSetting((s) =>
            s
                .setName(plural(fileScanner.wordCount, "known word", "known words"))
                .setDesc("Scan the vault to learn the words of all notes at once.")
                .addButton((b) =>
                    b.setButtonText("Forget all").onClick(() =>
                        new ConfirmationModal(
                            this.app,
                            "Forget all known words?",
                            "Until notes are scanned again, no words from your notes are suggested.",
                            (b) => b.setButtonText("Forget all").setWarning(),
                            async () => {
                                await fileScanner.deleteAllWords();
                                this.display();
                            },
                        ).open(),
                    ),
                )
                .addButton((b) =>
                    b
                        .setButtonText("Scan vault")
                        .setCta()
                        .onClick(
                            guarded(async () => {
                                b.setDisabled(true);
                                try {
                                    await this.plugin.scanVault();
                                } finally {
                                    this.display();
                                }
                            }),
                        ),
                ),
        );
    }

    private displayWordLists(containerEl: HTMLElement) {
        const { wordList } = this.plugin;
        const group = new SettingGroup(containerEl).setHeading("Word lists").addExtraButton((b) =>
            b
                .setIcon("refresh-cw")
                .setTooltip("Reload the word list files, e.g. after changing them outside of Obsidian")
                .onClick(guarded(() => this.reloadWords())),
        );
        this.toggle(group, "wordListProviderEnabled", "Enabled", "Suggest words from word list files.");

        group.addSetting((s) => {
            s.setName("Word list files").setDesc(
                `Text files with one word per line. ${plural(wordList.wordCount, "word", "words")} loaded.`,
            );
            s.settingEl.addClass("completr-drop-target");
            // Created in the setting's own document: settings can open in a popout window, and a file dialog can
            // only be opened by an input of the window that received the click.
            const fileInput = s.controlEl.createEl("input", {
                attr: { type: "file", multiple: true, accept: ".txt,.dic,.lst,text/plain" },
            });
            fileInput.hide();
            fileInput.addEventListener(
                "change",
                guarded(async () => {
                    const files = Array.from(fileInput.files ?? []);
                    fileInput.value = "";
                    await this.importWordLists(files);
                }),
            );
            s.controlEl.createSpan({ cls: "completr-drop-hint", text: "or drop files here" });
            s.addButton((b) =>
                b
                    .setButtonText("Import")
                    .setCta()
                    .onClick(() => fileInput.click()),
            );

            const { settingEl } = s;
            settingEl.addEventListener("dragover", (evt) => {
                if (!evt.dataTransfer?.types.includes("Files")) return;
                evt.preventDefault();
                evt.dataTransfer.dropEffect = "copy";
                settingEl.addClass("is-dragging-over");
            });
            settingEl.addEventListener("dragleave", (evt) => {
                if (!settingEl.contains(evt.relatedTarget as Node | null)) settingEl.removeClass("is-dragging-over");
            });
            const drop = guarded((files: File[]) => this.importWordLists(files));
            settingEl.addEventListener("drop", (evt) => {
                settingEl.removeClass("is-dragging-over");
                const files = Array.from(evt.dataTransfer?.files ?? []);
                if (files.length === 0) return;
                evt.preventDefault();
                void drop(files);
            });
        });

        const addFiles = guarded(async () => {
            for (const name of await wordList.getFileNames()) {
                group.addSetting((s) =>
                    s.setName(name).addExtraButton((b) =>
                        b
                            .setIcon("trash")
                            .setTooltip("Remove")
                            .onClick(() =>
                                new ConfirmationModal(
                                    this.app,
                                    `Delete ${name}?`,
                                    "The file will be deleted and its words won't be suggested anymore.",
                                    (b) => b.setButtonText("Delete").setWarning(),
                                    async () => {
                                        await wordList.deleteWordList(name);
                                        await this.reloadWords();
                                    },
                                ).open(),
                            ),
                    ),
                );
            }
        });
        void addFiles();
    }

    private displayLatex(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("LaTeX");
        this.toggle(
            group,
            "latexProviderEnabled",
            "Enabled",
            "Suggest LaTeX commands inside math blocks ($...$ and $$...$$).",
        );
        this.toggle(
            group,
            "latexBuiltInCommands",
            "Built-in commands",
            "Suggest the built-in commands. Disable to only use your own. Single commands can be hidden with the blacklist.",
        );
        this.customEntries(group, this.plugin.latex.customEntries);
        this.toggle(
            group,
            "latexTriggerInCodeBlocks",
            "Trigger in code",
            "Also trigger after dollar signs inside code blocks or inline code, e.g. `$\\fr`.",
        );
        this.toggle(group, "latexIgnoreCase", "Ignore case", "'MaThbb' also suggests 'mathbb'.");
        this.toggle(group, "latexPreview", "Preview", "Show what each command looks like next to it in the popup.");
        this.number(
            group,
            "latexMinWordTriggerLength",
            "Minimum typed length",
            "How many characters have to be typed before LaTeX suggestions appear.",
            1,
        );
    }

    private displaySnippets(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("Snippets");
        this.toggle(
            group,
            "snippetsEnabled",
            "Enabled",
            "Suggest your own snippets outside of math blocks. A name can start with a character like : or / to keep it apart from normal words, e.g. :sig.",
        );
        this.customEntries(group, this.plugin.snippets.customEntries);
    }

    private displayFrontMatter(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("Front matter");
        this.toggle(
            group,
            "frontMatterProviderEnabled",
            "Enabled",
            "Suggest keys and values in the YAML front matter (in source mode), based on the front matter of all notes.",
        );
        this.toggle(group, "frontMatterIgnoreCase", "Ignore case", "'MyTag' also suggests 'mytag'.");
        this.toggle(
            group,
            "frontMatterTagAppendSuffix",
            "Add separator after list values",
            "After completing a value of a list, add ', ' or a new list item, so the next value can be typed right away.",
        );
    }

    private displayCallouts(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("Callouts");
        this.toggle(group, "calloutProviderEnabled", "Enabled", "Suggest callout types after typing '> [!'.");
        const calloutManager = isCalloutManagerInstalled(this.app);
        this.dropdown(
            group,
            "calloutProviderSource",
            "Source",
            calloutManager
                ? "Where the callout types come from."
                : "Install the Callout Manager plugin to use the callouts configured there.",
            {
                [CalloutProviderSource.COMPLETR]: "Completr (callout_suggestions.json)",
                ...(calloutManager || this.settings.calloutProviderSource === CalloutProviderSource.CALLOUT_MANAGER
                    ? { [CalloutProviderSource.CALLOUT_MANAGER]: "Callout Manager" }
                    : {}),
            },
            async () => {
                const error = await this.plugin.callout.load(this.settings);
                if (error) new Notice("Completr: " + error);
            },
        );
    }

    private displayBlacklist(containerEl: HTMLElement) {
        const { blacklist } = this.plugin;
        const group = new SettingGroup(containerEl).setHeading("Blacklist");
        group.addSetting((s) =>
            s
                .setName(plural(blacklist.size, "blacklisted suggestion", "blacklisted suggestions"))
                .setDesc(
                    `Blacklisted suggestions are never shown. To hide a suggestion, hover it in the popup and click the eye icon, or select it and press ${this.hotkey(BLACKLIST_COMMAND)}.`,
                )
                .addButton((b) =>
                    b.setButtonText("Manage").onClick(() =>
                        new ListModal<string>(this.app, {
                            title: "Blacklist",
                            emptyText: () => "No suggestions are blacklisted.",
                            items: () => blacklist.values().sort(),
                            name: (entry) => entry,
                            onRemove: (entry) => blacklist.remove(entry),
                            removeTooltip: "Remove from blacklist",
                            onClose: () => this.display(),
                        }).open(),
                    ),
                ),
        );
    }

    private async importWordLists(files: File[]) {
        let changed = false;
        for (const file of files) {
            const success = await this.plugin.wordList.importWordList(file.name, decodeText(await file.arrayBuffer()));
            changed ||= success;
            if (!success) new Notice(`Unable to import ${file.name} because it already exists.`);
        }
        if (changed) await this.reloadWords();
    }

    /** Reloads the word lists and shows the result. Waits for a reload that is already running. */
    private reloadWords(): Promise<void> {
        const reload = this.wordListReload
            .catch(() => {})
            .then(async () => {
                const count = await this.plugin.wordList.load(this.settings);
                new Notice(`Completr: Loaded ${plural(count, "word", "words")}`);
                this.display();
            });
        this.wordListReload = reload;
        return reload;
    }
}
