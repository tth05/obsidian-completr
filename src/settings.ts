import {App, PluginSettingTab, Setting} from "obsidian";
import CompletrPlugin from "./main";
import {WordList} from "./provider/word_list_provider";

export interface CompletrSettings {
    worldListFiles: string[],
    minWordLength: number,
}

export const DEFAULT_SETTINGS: CompletrSettings = {
    worldListFiles: [],
    minWordLength: 6,
}

export default class CompletrSettingsTab extends PluginSettingTab {

    private plugin: CompletrPlugin;

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
                        WordList.loadFromFiles(this.plugin.settings);
                    });
            });

        const fileInput = createEl("input", {
            attr: {
                type: "file",
            }
        });

        fileInput.onchange = async () => {
            const files = fileInput.files;
            if (files.length < 1)
                return;

            const oldLength = this.plugin.settings.worldListFiles.length;
            for (let i = 0; i < files.length; i++) {
                const path = (files[i] as any).path;
                if (!this.plugin.settings.worldListFiles.contains(path))
                    this.plugin.settings.worldListFiles.push(path);
            }

            //Only refresh if something was added
            if (oldLength === this.plugin.settings.worldListFiles.length)
                return;

            await this.plugin.saveSettings();
            WordList.loadFromFiles(this.plugin.settings);
            this.display();
        }

        new Setting(containerEl)
            .setName('Word list files')
            .setDesc('A list of files which contain words to be used as suggestions.')
            .addExtraButton(button => button
                .setIcon("switch")
                .setTooltip("Reload")
                .onClick(() => WordList.loadFromFiles(this.plugin.settings)))
            .addButton(button => {
                button.buttonEl.appendChild(fileInput);
                button
                    .setButtonText("+")
                    .setCta()
                    .onClick(() => fileInput.click());
            });

        const wordListDiv = containerEl.createDiv();
        for (let path of this.plugin.settings.worldListFiles) {
            new Setting(wordListDiv)
                .setName(path)
                .addExtraButton((button) => button
                    .setIcon("trash")
                    .setTooltip("Remove")
                    .onClick(async () => {
                        this.plugin.settings.worldListFiles.remove(path);
                        await this.plugin.saveSettings();
                        WordList.loadFromFiles(this.plugin.settings);
                        this.display();
                    })
                ).settingEl.addClass("completr-settings-list-item");
        }
    }
}
