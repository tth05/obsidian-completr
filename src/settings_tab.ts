import {App, ButtonComponent, Modal, PluginSettingTab, Setting} from "obsidian";
import CompletrPlugin from "./main";
import {FileScanner} from "./provider/scanner_provider";
import {WordList} from "./provider/word_list_provider";
import {CompletrSettings, WordListInsertionMode} from "./settings";

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
            .setName("Word separators")
            .setDesc("All characters which determine where a word starts and where a word ends. Used during suggestion and by the file scanner.")
            .addText(text => text
                .setValue(this.plugin.settings.wordSeparators)
                .onChange(async val => {
                    this.plugin.settings.wordSeparators = val;
                    await this.plugin.saveSettings();
                }))

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
            .setName("Latex provider")
            .setHeading();

        this.createEnabledSetting("latexProviderEnabled", "Whether or not the latex provider is enabled", containerEl);

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
            .setName("Word character regex")
            .setDesc("A regular expression which matches a character of a word. All repetitions of this character regex will be saved as valid words.")
            .addText(text => text
                .setValue(this.plugin.settings.fileScannerCharacterRegex)
                .onChange(async val => {
                    try {
                        //Check if regex is valid
                        new RegExp("[" + val + "]+").test("");
                        text.inputEl.removeClass("completr-settings-error");
                        this.plugin.settings.fileScannerCharacterRegex = val;
                        await this.plugin.saveSettings();
                    } catch (e) {
                        text.inputEl.addClass("completr-settings-error");
                    }
                }));

        new Setting(containerEl)
            .setName("Word list provider")
            .setHeading();

        this.createEnabledSetting("wordListProviderEnabled", "Whether or not the word list provider is enabled", containerEl);

        new Setting(containerEl)
            .setName("Suggestion mode")
            .setDesc("The insertion mode that is used. Ignore-case would suggest 'Hello' if the typed text is 'hello', match-case would not. " +
                "Append would complete 'Hell' with 'Hello' while replace would complete it with 'hello' instead (if only 'hello' was a known word).")
            .addDropdown(dropdown => dropdown
                .addOption(WordListInsertionMode.IGNORE_CASE_REPLACE, WordListInsertionMode.IGNORE_CASE_REPLACE)
                .addOption(WordListInsertionMode.IGNORE_CASE_APPEND, WordListInsertionMode.IGNORE_CASE_APPEND)
                .addOption(WordListInsertionMode.MATCH_CASE_REPLACE, WordListInsertionMode.MATCH_CASE_REPLACE)
                .setValue(this.plugin.settings.wordListInsertionMode)
                .onChange(async val => {
                    this.plugin.settings.wordListInsertionMode = val as WordListInsertionMode;
                    await this.plugin.saveSettings();
                })
            );

        const fileInput = createEl("input", {
            attr: {
                type: "file",
            }
        });

        fileInput.onchange = async () => {
            const files = fileInput.files;
            if (files.length < 1)
                return;

            const oldLength = this.plugin.settings.wordListFiles.length;
            for (let i = 0; i < files.length; i++) {
                const path = (files[i] as any).path;
                if (!this.plugin.settings.wordListFiles.contains(path))
                    this.plugin.settings.wordListFiles.push(path);
            }

            //Only refresh if something was added
            if (oldLength === this.plugin.settings.wordListFiles.length)
                return;

            await this.reloadWords();
            await this.plugin.saveSettings();
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
        for (let path of this.plugin.settings.wordListFiles) {
            new Setting(wordListDiv)
                .setName(path)
                .addExtraButton((button) => button
                    .setIcon("trash")
                    .setTooltip("Remove")
                    .onClick(async () => {
                        this.plugin.settings.wordListFiles.remove(path);
                        await this.reloadWords();
                        await this.plugin.saveSettings();
                        this.display();
                    })
                ).settingEl.addClass("completr-settings-list-item");
        }
    }

    private async reloadWords() {
        if (this.isReloadingWords)
            return;

        this.isReloadingWords = true;
        await WordList.loadFromFiles(this.plugin.settings);
        this.isReloadingWords = false;
    }

    private createEnabledSetting(propertyName: keyof CompletrSettings, desc: string, container: HTMLElement) {
        new Setting(container)
            .setName("Enabled")
            .setDesc(desc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings[propertyName] as boolean)
                //@ts-ignore
                .onChange((val) => this.plugin.settings[propertyName] = val));
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
