import {App, ButtonComponent, Modal, Notice, PluginSettingTab, Setting} from "obsidian";
import CompletrPlugin from "./main";
import {FileScanner} from "./provider/scanner_provider";
import {WordList} from "./provider/word_list_provider";
import {CompletrSettings, WordInsertionMode} from "./settings";
import {TextDecoder} from "util";
import {detect} from "jschardet";

export default class CompletrSettingsTab extends PluginSettingTab {

    private plugin: CompletrPlugin;
    private isReloadingWords: boolean;

    constructor(app: App, plugin: CompletrPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): any {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Word character regex")
            .setDesc("A regular expression which matches a character of a word. Used by during completion to find the word to the left of the cursor and used by the file scanner to find valid words.")
            .addText(text => text
                .setValue(this.plugin.settings.characterRegex)
                .onChange(async val => {
                    try {
                        //Check if regex is valid
                        new RegExp("[" + val + "]+").test("");
                        text.inputEl.removeClass("completr-settings-error");
                        this.plugin.settings.characterRegex = val;
                        await this.plugin.saveSettings();
                    } catch (e) {
                        text.inputEl.addClass("completr-settings-error");
                    }
                }));

        new Setting(containerEl)
            .setName("Minimum word length")
            .setDesc("The minimum length a word has to be, to count as a valid suggestion. This value is used by the file" +
                " scanner and word list provider.")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(this.plugin.settings.minWordLength + "")
                    .onChange(async val => {
                        if (!val || val.length < 1)
                            return;

                        this.plugin.settings.minWordLength = parseInt(val);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Minimum word trigger length")
            .setDesc("The minimum length a word has to be, to trigger suggestions. The LaTeX provider has its own separate setting.")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(this.plugin.settings.minWordTriggerLength + "")
                    .onChange(async val => {
                        if (!val || val.length < 1)
                            return;

                        this.plugin.settings.minWordTriggerLength = parseInt(val);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Word insertion mode")
            .setDesc("The insertion mode that is used. Ignore-case would suggest 'Hello' if the typed text is 'hello', match-case would not. " +
                "Append would complete 'Hell' with 'Hello' while replace would complete it with 'hello' instead (if only 'hello' was a known word). Only used by the file scanner and word list provider.")
            .addDropdown(dropdown => dropdown
                .addOption(WordInsertionMode.IGNORE_CASE_REPLACE, WordInsertionMode.IGNORE_CASE_REPLACE)
                .addOption(WordInsertionMode.IGNORE_CASE_APPEND, WordInsertionMode.IGNORE_CASE_APPEND)
                .addOption(WordInsertionMode.MATCH_CASE_REPLACE, WordInsertionMode.MATCH_CASE_REPLACE)
                .setValue(this.plugin.settings.wordInsertionMode)
                .onChange(async val => {
                    this.plugin.settings.wordInsertionMode = val as WordInsertionMode;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Ignore diacritics when filtering")
            .setDesc("When enabled, the query 'Hello' can suggest 'Hèllò', meaning diacritics will be ignored when filtering the suggestions. Only used by the file scanner and word list provider.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ignoreDiacriticsWhenFiltering)
                .onChange(async val => {
                    this.plugin.settings.ignoreDiacriticsWhenFiltering = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Latex provider")
            .setHeading();

        this.createEnabledSetting("latexProviderEnabled", "Whether or not the latex provider is enabled", containerEl);

        new Setting(containerEl)
            .setName("Trigger in code blocks")
            .setDesc("Whether the LaTeX provider should trigger after dollar signs which are enclosed in code blocks (for example ```$\\fr```).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.latexTriggerInCodeBlocks)
                .onChange(async val => {
                    this.plugin.settings.latexTriggerInCodeBlocks = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Ignore case")
            .setDesc("Whether the LaTeX provider should ignore the casing of the typed text. If so, the input 'MaThbb' could suggest 'mathbb'.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.latexIgnoreCase)
                .onChange(async val => {
                    this.plugin.settings.latexIgnoreCase = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Minimum word trigger length")
            .setDesc("The minimum length a query has to be, to trigger suggestions.")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(this.plugin.settings.latexMinWordTriggerLength + "")
                    .onChange(async val => {
                        if (!val || val.length < 1)
                            return;

                        this.plugin.settings.latexMinWordTriggerLength = parseInt(val);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Front matter provider")
            .addExtraButton(button => button
                .setIcon("link")
                .setTooltip("Obsidian Front-Matter wiki")
                .onClick(() => window.open("https://help.obsidian.md/Advanced+topics/YAML+front+matter")))
            .setHeading();

        this.createEnabledSetting("frontMatterProviderEnabled", "Whether the front matter provider is enabled", containerEl);

        new Setting(containerEl)
            .setName("Ignore case")
            .setDesc("Whether the Front matter provider should ignore the casing of the typed text. If so, the input 'MaThbb' could suggest 'mathbb'.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.frontMatterIgnoreCase)
                .onChange(async val => {
                    this.plugin.settings.frontMatterIgnoreCase = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Add suffix to tag completion")
            .setDesc("Whether each completed tag should be suffixed with a comma or a newline (when typing in a multi-line list). Allows faster insertion of multiple tags.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.frontMatterTagAppendSuffix)
                .onChange(async val => {
                    this.plugin.settings.frontMatterTagAppendSuffix = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("File scanner provider")
            .setHeading()
            .addExtraButton(button => button
                .setIcon("search")
                .setTooltip("Immediately scan all .md files currently in your vault.")
                .onClick(() => {
                    new ConfirmationModal(this.plugin.app,
                        "Start scanning?",
                        "Depending on the size of your vault and computer, this may take a while.",
                        button => button
                            .setButtonText("Scan")
                            .setCta(),
                        async () => {
                            await FileScanner.scanFiles(this.plugin.settings, this.plugin.app.vault.getMarkdownFiles());
                        },
                    ).open();
                }))
            .addExtraButton(button => button
                .setIcon("trash")
                .setTooltip("Delete all known words.")
                .onClick(async () => {
                    new ConfirmationModal(this.plugin.app,
                        "Delete all known words?",
                        "This will delete all words that have been scanned. No suggestions from this provider will show up anymore until new files are scanned.",
                        button => button
                            .setButtonText("Delete")
                            .setWarning(),
                        async () => {
                            await FileScanner.deleteAllWords(this.plugin.app.vault);
                        },
                    ).open();
                }));

        this.createEnabledSetting("fileScannerProviderEnabled", "Whether or not the file scanner provider is enabled.", containerEl);

        new Setting(containerEl)
            .setName("Scan active file")
            .setDesc("If this setting is enabled, the currently opened file will be scanned to find new words.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fileScannerScanCurrent)
                .onChange(async val => {
                    this.plugin.settings.fileScannerScanCurrent = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Word list provider")
            .setHeading();

        this.createEnabledSetting("wordListProviderEnabled", "Whether or not the word list provider is enabled", containerEl);

        const fileInput = createEl("input", {
            attr: {
                type: "file",
            }
        });

        fileInput.onchange = async () => {
            const files = fileInput.files;
            if (files.length < 1)
                return;

            let changed = false;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                try {
                    const buf = await file.arrayBuffer();
                    const encoding = detect(Buffer.from(buf.slice(0, 1024))).encoding;
                    const text = new TextDecoder(encoding).decode(buf);
                    const success = await WordList.importWordList(this.app.vault, file.name, text);
                    changed ||= success;

                    if (!success)
                        new Notice("Unable to import " + file.name + " because it already exists!");
                } catch (e) {
                    console.error(e);
                    new Notice("Error while importing " + file.name);
                }
            }

            // Only refresh if something was added
            if (!changed)
                return;

            await this.reloadWords();
            this.display();
        }

        new Setting(containerEl)
            .setName('Word list files')
            .setDesc('A list of files which contain words to be used as suggestions. Each word should be on its own line.')
            .addExtraButton(button => button
                .setIcon("switch")
                .setTooltip("Reload")
                .onClick(async () => {
                    await this.reloadWords();
                    //Refresh because loadFromFiles might have removed an invalid file
                    this.display();
                }))
            .addButton(button => {
                button.buttonEl.appendChild(fileInput);
                button
                    .setButtonText("+")
                    .setCta()
                    .onClick(() => fileInput.click());
            });

        const wordListDiv = containerEl.createDiv();
        WordList.getRelativeFilePaths(this.app.vault).then((names) => {
            for (const name of names) {
                new Setting(wordListDiv)
                    .setName(name)
                    .addExtraButton((button) => button
                        .setIcon("trash")
                        .setTooltip("Remove")
                        .onClick(async () => {
                            new ConfirmationModal(
                                this.app,
                                "Delete " + name + "?",
                                "The file will be removed and the words inside of it won't show up as suggestions anymore.",
                                button => button
                                    .setButtonText("Delete")
                                    .setWarning(),
                                async () => {
                                    await WordList.deleteWordList(this.app.vault, name);
                                    await this.reloadWords();
                                    this.display();
                                }).open();
                        })
                    ).settingEl.addClass("completr-settings-list-item");
            }
        });

        new Setting(containerEl)
            .setName("Callout provider")
            .setHeading();

        this.createEnabledSetting("calloutProviderEnabled", "Whether or not the callout provider is enabled", containerEl);
    }

    private async reloadWords() {
        if (this.isReloadingWords)
            return;

        this.isReloadingWords = true;
        const count = await WordList.loadFromFiles(this.app.vault, this.plugin.settings);
        this.isReloadingWords = false;

        new Notice(`Loaded ${count} words`);
    }

    private createEnabledSetting(propertyName: keyof CompletrSettings, desc: string, container: HTMLElement) {
        new Setting(container)
            .setName("Enabled")
            .setDesc(desc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings[propertyName] as boolean)
                //@ts-ignore
                .onChange(async (val) => {
                    // @ts-ignore
                    this.plugin.settings[propertyName] = val;
                    await this.plugin.saveSettings();
                }));
    }
}

class ConfirmationModal extends Modal {

    constructor(app: App, title: string, body: string, buttonCallback: (button: ButtonComponent) => void, clickCallback: () => Promise<void>) {
        super(app);
        this.titleEl.setText(title);
        this.contentEl.setText(body);
        new Setting(this.modalEl)
            .addButton(button => {
                buttonCallback(button);
                button.onClick(async () => {
                    await clickCallback();
                    this.close();
                })
            })
            .addButton(button => button
                .setButtonText("Cancel")
                .onClick(() => this.close())).settingEl.addClass("completr-settings-no-border");
    }
}
