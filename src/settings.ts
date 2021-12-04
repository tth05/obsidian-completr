import {App, PluginSettingTab, Setting} from "obsidian";
import CompletrPlugin from "./main";
import {WordList} from "./provider/word_list_provider";

export const enum WordListInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append"
}

export interface CompletrSettings {
    latexProviderEnabled: boolean,
    wordListProviderEnabled: boolean,
    wordListFiles: string[],
    wordListInsertionMode: WordListInsertionMode,
    minWordLength: number,
}

export const DEFAULT_SETTINGS: CompletrSettings = {
    latexProviderEnabled: true,
    wordListProviderEnabled: true,
    wordListFiles: [],
    wordListInsertionMode: WordListInsertionMode.IGNORE_CASE_REPLACE,
    minWordLength: 6,
}

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
