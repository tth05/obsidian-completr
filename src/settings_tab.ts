import {
    type App,
    type ButtonComponent,
    Modal,
    Notice,
    PluginSettingTab,
    Setting,
    SettingGroup,
    type TextComponent,
} from "obsidian";
import { isInstalled as isCalloutManagerInstalled } from "obsidian-callout-manager";
import { decodeText } from "./data_files.ts";
import type CompletrPlugin from "./main.ts";
import type { CustomEntry } from "./provider/custom_suggestions.ts";
import { CUSTOM_LATEX_COMMANDS_FILE } from "./provider/latex_provider.ts";
import { SNIPPETS_FILE } from "./provider/snippet_provider.ts";
import { CalloutProviderSource, type CompletrSettings, IconMode, SortOrder, WordInsertionMode } from "./settings.ts";
import { compileCharacterClass } from "./text.ts";

type BooleanKey = {
    [K in keyof CompletrSettings]: CompletrSettings[K] extends boolean ? K : never;
}[keyof CompletrSettings];
type NumberKey = {
    [K in keyof CompletrSettings]: CompletrSettings[K] extends number ? K : never;
}[keyof CompletrSettings];

export default class CompletrSettingsTab extends PluginSettingTab {
    private isReloadingWords = false;

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

    // ---- Setting builders -------------------------------------------------------------------------------------------

    private toggle(group: SettingGroup, key: BooleanKey, name: string, desc: string, onChange?: () => unknown) {
        group.addSetting((s) =>
            s
                .setName(name)
                .setDesc(desc)
                .addToggle((t) =>
                    t.setValue(this.settings[key]).onChange(async (value) => {
                        this.settings[key] = value;
                        await this.save();
                        await onChange?.();
                    }),
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
                        .onChange(async (value) => {
                            (this.settings as unknown as Record<string, unknown>)[key] = value;
                            await this.save();
                            await onChange?.();
                        }),
                ),
        );
    }

    // ---- Display ------------------------------------------------------------------------------------------------

    override display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.displayGeneral(containerEl);
        this.displayMatching(containerEl);
        this.displayLatex(containerEl);
        this.displaySnippets(containerEl);
        this.displayFrontMatter(containerEl);
        this.displayFileScanner(containerEl);
        this.displayWordLists(containerEl);
        this.displayCallouts(containerEl);
        this.displayBlacklist(containerEl);
    }

    private displayGeneral(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl);
        this.toggle(
            group,
            "autoTrigger",
            "Open automatically",
            'Open the popup while typing. Otherwise use the "Open suggestion popup" command (Ctrl/Cmd+Space). Can be toggled with a command.',
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
                .setName("Hotkeys")
                .setDesc(
                    "All keys used in the popup (arrows, Enter, Escape, ...) are commands and can be changed in the hotkey settings.",
                )
                .addButton((b) =>
                    b.setButtonText("Open hotkeys").onClick(() => {
                        const setting = (
                            this.app as unknown as {
                                setting: { openTabById(id: string): { setQuery?(q: string): void } };
                            }
                        ).setting;
                        setting.openTabById("hotkeys")?.setQuery?.(this.plugin.manifest.id);
                    }),
                ),
        );
    }

    private displayMatching(containerEl: HTMLElement) {
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
            "Insertion mode",
            "Ignore-case suggests 'Hello' for 'hello', match-case does not. Append keeps what you typed and completes it ('Hell' -> 'Hello' even if only 'hello' is known), replace inserts the known word.",
            {
                [WordInsertionMode.IGNORE_CASE_REPLACE]: WordInsertionMode.IGNORE_CASE_REPLACE,
                [WordInsertionMode.IGNORE_CASE_APPEND]: WordInsertionMode.IGNORE_CASE_APPEND,
                [WordInsertionMode.MATCH_CASE_REPLACE]: WordInsertionMode.MATCH_CASE_REPLACE,
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
        this.dropdown(group, "sortOrder", "Sort order", "How word suggestions are ordered.", {
            [SortOrder.SHORTEST_FIRST]: "Shortest first",
            [SortOrder.LONGEST_FIRST]: "Longest first",
            [SortOrder.ALPHABETICAL]: "Alphabetical",
        });
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
        this.toggle(group, "rankByUsage", "Rank by usage", "Suggestions you insert often are listed first.");
        this.toggle(group, "insertSpaceAfterWord", "Add space after words", "Insert a space after a completed word.");
        this.toggle(
            group,
            "disableWordsInCode",
            "No words in code",
            "Don't suggest words inside code blocks and inline code.",
        );
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
            "Suggest the built-in commands. Disable to only use your own. Single commands can be hidden with the blacklist (Ctrl/Cmd+Shift+D).",
        );
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

        const { latex } = this.plugin;
        this.displayCustomEntries(containerEl, {
            heading: "Custom LaTeX commands",
            description:
                "Your own suggestions inside math blocks. In the replacement, # marks a placeholder (jump with Enter) and ~ the final cursor position.",
            addButton: "Add command",
            modal: {
                title: "Add LaTeX command",
                namePlaceholder: "\\frac{#}{#}",
                replacementPlaceholder: "\\frac{#}{#}",
                nameRequired: false,
            },
            fileName: CUSTOM_LATEX_COMMANDS_FILE,
            get: () => latex.getCustomCommands(),
            set: (entries) => latex.setCustomCommands(entries),
            reload: () => latex.load(false),
        });
    }

    private displaySnippets(containerEl: HTMLElement) {
        const { snippets } = this.plugin;
        const group = new SettingGroup(containerEl).setHeading("Snippets");
        this.toggle(
            group,
            "snippetsEnabled",
            "Enabled",
            "Suggest your own snippets outside of math blocks: type the start of a snippet's name to insert its text.",
        );
        this.displayCustomEntries(containerEl, {
            description:
                "In the text, {{}} marks a placeholder (jump with Enter), {{some text}} a placeholder with default text and {{cursor}} the final cursor position. Snippets may span multiple lines.",
            addButton: "Add snippet",
            modal: {
                title: "Add snippet",
                namePlaceholder: "meeting",
                replacementPlaceholder: "## Meeting {{title}}\nAttendees: {{}}\n\n{{cursor}}",
                nameRequired: true,
            },
            fileName: SNIPPETS_FILE,
            get: () => snippets.snippets,
            set: (entries) => snippets.setSnippets(entries),
            reload: () => snippets.load(),
        });
    }

    /** A list of user defined entries (custom LaTeX commands, snippets) stored in a JSON file. */
    private displayCustomEntries(
        containerEl: HTMLElement,
        opts: {
            heading?: string;
            description: string;
            addButton: string;
            modal: CustomEntryModalOptions;
            fileName: string;
            get: () => readonly CustomEntry[];
            set: (entries: CustomEntry[]) => Promise<void>;
            reload: () => Promise<string | null>;
        },
    ) {
        const group = new SettingGroup(containerEl);
        if (opts.heading) group.setHeading(opts.heading);
        group
            .addExtraButton((b) =>
                b
                    .setIcon("folder-open")
                    .setTooltip(`Open ${opts.fileName}`)
                    .onClick(() => this.app.openWithDefaultApp(this.plugin.files.path(opts.fileName))),
            )
            .addExtraButton((b) =>
                b
                    .setIcon("refresh-cw")
                    .setTooltip("Reload from file")
                    .onClick(async () => {
                        const error = await opts.reload();
                        new Notice(error ?? `Completr: Loaded ${opts.get().length} entries from ${opts.fileName}`);
                        this.display();
                    }),
            );
        group.addSetting((s) =>
            s.setDesc(opts.description).addButton((b) =>
                b
                    .setButtonText(opts.addButton)
                    .setCta()
                    .onClick(() =>
                        new CustomEntryModal(this.app, opts.modal, async (displayName, replacement) => {
                            await opts.set([...opts.get(), { displayName, replacement }]);
                            this.display();
                        }).open(),
                    ),
            ),
        );
        const entries = opts.get();
        entries.forEach((entry, i) =>
            group.addSetting((s) => {
                s.setName(entry.displayName).addExtraButton((b) =>
                    b
                        .setIcon("trash")
                        .setTooltip("Remove")
                        .onClick(async () => {
                            await opts.set(entries.filter((_, j) => j !== i));
                            this.display();
                        }),
                );
                if (entry.replacement !== entry.displayName) s.setDesc(entry.replacement);
            }),
        );
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

    private displayFileScanner(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl)
            .setHeading("File scanner")
            .addExtraButton((b) =>
                b
                    .setIcon("search")
                    .setTooltip("Scan all notes in the vault now")
                    .onClick(() =>
                        new ConfirmationModal(
                            this.app,
                            "Scan the whole vault?",
                            "Depending on the size of your vault, this may take a moment.",
                            (b) => b.setButtonText("Scan").setCta(),
                            async () => {
                                const { vault } = this.app;
                                for (const file of vault.getMarkdownFiles())
                                    this.plugin.fileScanner.addText(await vault.cachedRead(file), this.settings);
                                await this.plugin.fileScanner.flush();
                                new Notice(`Completr: ${this.plugin.fileScanner.wordCount} known words`);
                            },
                        ).open(),
                    ),
            )
            .addExtraButton((b) =>
                b
                    .setIcon("trash")
                    .setTooltip("Forget all scanned words")
                    .onClick(() =>
                        new ConfirmationModal(
                            this.app,
                            "Forget all scanned words?",
                            "Until notes are scanned again, the file scanner won't suggest anything.",
                            (b) => b.setButtonText("Delete").setWarning(),
                            () => this.plugin.fileScanner.deleteAllWords(),
                        ).open(),
                    ),
            );
        this.toggle(group, "fileScannerProviderEnabled", "Enabled", "Suggest words that appear in your notes.");
        this.toggle(
            group,
            "fileScannerScanCurrent",
            "Learn words while writing",
            "Remember the words of the note you're editing. Use the scan button above to learn the words of all notes.",
        );
        this.toggle(
            group,
            "fileScannerCurrentFileOnly",
            "Only words from the current note",
            "Only suggest words that appear in the note you're editing.",
        );
    }

    private displayWordLists(containerEl: HTMLElement) {
        const group = new SettingGroup(containerEl).setHeading("Word lists").addExtraButton((b) =>
            b
                .setIcon("refresh-cw")
                .setTooltip("Reload word lists")
                .onClick(async () => {
                    await this.reloadWords();
                    this.display();
                }),
        );
        this.toggle(group, "wordListProviderEnabled", "Enabled", "Suggest words from word list files.");

        const fileInput = createEl("input", {
            attr: { type: "file", multiple: true, accept: ".txt,.dic,.lst,text/plain" },
        });
        fileInput.onchange = async () => {
            const files = Array.from(fileInput.files ?? []);
            let changed = false;
            for (const file of files) {
                try {
                    const success = await this.plugin.wordList.importWordList(
                        file.name,
                        decodeText(await file.arrayBuffer()),
                    );
                    changed ||= success;
                    if (!success) new Notice(`Unable to import ${file.name} because it already exists.`);
                } catch (e) {
                    console.error(e);
                    new Notice("Error while importing " + file.name);
                }
            }
            fileInput.value = "";
            if (!changed) return;
            await this.reloadWords();
            this.display();
        };

        group.addSetting((s) =>
            s
                .setName("Word list files")
                .setDesc("Text files with one word per line.")
                .addButton((b) =>
                    b
                        .setButtonText("Import")
                        .setCta()
                        .onClick(() => fileInput.click()),
                ),
        );

        void this.plugin.wordList.getFilePaths().then((paths) => {
            for (const path of paths) {
                group.addSetting((s) =>
                    s.setName(path.substring(path.lastIndexOf("/") + 1)).addExtraButton((b) =>
                        b
                            .setIcon("trash")
                            .setTooltip("Remove")
                            .onClick(() =>
                                new ConfirmationModal(
                                    this.app,
                                    `Delete ${path.substring(path.lastIndexOf("/") + 1)}?`,
                                    "The file will be deleted and its words won't be suggested anymore.",
                                    (b) => b.setButtonText("Delete").setWarning(),
                                    async () => {
                                        await this.plugin.wordList.deleteWordList(path);
                                        await this.reloadWords();
                                        this.display();
                                    },
                                ).open(),
                            ),
                    ),
                );
            }
        });
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
            s.setDesc(
                blacklist.size > 0
                    ? "These suggestions are never shown. Add more by selecting a suggestion and pressing Ctrl/Cmd+Shift+D."
                    : "No suggestions are blacklisted. Hide a suggestion by selecting it in the popup and pressing Ctrl/Cmd+Shift+D.",
            ),
        );
        if (blacklist.size === 0) return;

        group.addSearch((search) =>
            search.setPlaceholder("Filter...").onChange((query) => {
                const q = query.toLowerCase();
                for (const el of Array.from(group.listEl.querySelectorAll<HTMLElement>(".completr-blacklist-item"))) {
                    el.toggle((el.dataset.entry ?? "").toLowerCase().includes(q));
                }
            }),
        );
        for (const entry of blacklist.values().sort()) {
            group.addSetting((s) => {
                s.settingEl.addClass("completr-blacklist-item");
                s.settingEl.dataset.entry = entry;
                s.setName(entry).addExtraButton((b) =>
                    b
                        .setIcon("x")
                        .setTooltip("Remove from blacklist")
                        .onClick(async () => {
                            await this.plugin.unblacklistSuggestion(entry);
                            this.display();
                        }),
                );
            });
        }
    }

    private async reloadWords() {
        if (this.isReloadingWords) return;
        this.isReloadingWords = true;
        try {
            const count = await this.plugin.wordList.load(this.settings);
            new Notice(`Completr: Loaded ${count} words`);
        } finally {
            this.isReloadingWords = false;
        }
    }
}

class ConfirmationModal extends Modal {
    constructor(
        app: App,
        title: string,
        body: string,
        configureButton: (button: ButtonComponent) => void,
        onConfirm: () => Promise<unknown>,
    ) {
        super(app);
        this.setTitle(title);
        this.contentEl.createEl("p", { text: body });
        new Setting(this.contentEl)
            .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((b) => {
                configureButton(b);
                b.onClick(async () => {
                    b.setDisabled(true);
                    await onConfirm();
                    this.close();
                });
            });
    }
}

interface CustomEntryModalOptions {
    title: string;
    namePlaceholder: string;
    replacementPlaceholder: string;
    /** If false, the name defaults to the replacement. */
    nameRequired: boolean;
}

class CustomEntryModal extends Modal {
    constructor(
        app: App,
        opts: CustomEntryModalOptions,
        onSubmit: (displayName: string, replacement: string) => Promise<void>,
    ) {
        super(app);
        this.setTitle(opts.title);
        let displayName = "";
        let replacement = "";
        new Setting(this.contentEl)
            .setName("Name")
            .setDesc(
                opts.nameRequired
                    ? "What you type to get this suggestion. Shown in the popup."
                    : "Shown in the popup and used for matching. Defaults to the replacement.",
            )
            .addText((t) => t.setPlaceholder(opts.namePlaceholder).onChange((v) => (displayName = v)));
        new Setting(this.contentEl)
            .setName("Replacement")
            .setDesc("The inserted text. # marks a placeholder, ~ the final cursor position. May span multiple lines.")
            .addTextArea((t) => {
                t.inputEl.rows = 4;
                t.inputEl.addClass("completr-replacement-input");
                t.setPlaceholder(opts.replacementPlaceholder).onChange((v) => (replacement = v));
            });
        new Setting(this.contentEl).addButton((b) =>
            b
                .setButtonText("Add")
                .setCta()
                .onClick(async () => {
                    if (!replacement.trim()) {
                        new Notice("The replacement can't be empty.");
                        return;
                    }
                    if (opts.nameRequired && !displayName.trim()) {
                        new Notice("The name can't be empty.");
                        return;
                    }
                    const name = (displayName.trim() || replacement).replace(/\n/g, " ");
                    await onSubmit(name, replacement);
                    this.close();
                }),
        );
    }
}
