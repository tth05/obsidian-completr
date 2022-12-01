import {CompletrSettings, intoCompletrPath} from "../settings";
import {DictionaryProvider} from "./dictionary_provider";
import {Vault} from "obsidian";
import {SuggestionBlacklist} from "./blacklist";

const WORD_LISTS_FOLDER_PATH = "wordLists";
const NEW_LINE_REGEX = /\r?\n/;

class WordListSuggestionProvider extends DictionaryProvider {

    readonly wordMap: Map<string, string[]> = new Map<string, string[]>();

    isEnabled(settings: CompletrSettings): boolean {
        return settings.wordListProviderEnabled;
    }

    async loadFromFiles(vault: Vault, settings: CompletrSettings): Promise<number> {
        this.wordMap.clear();

        const fileNames = await this.getRelativeFilePaths(vault);
        // Read all files
        for (let i = fileNames.length - 1; i >= 0; i--) {
            const fileName = fileNames[i];

            let data: string;
            try {
                data = await vault.adapter.read(fileName);
            } catch (e) {
                console.log("Completr: Unable to read " + fileName);
                continue;
            }

            // Each line is a word
            const lines = data.split(NEW_LINE_REGEX);
            for (let line of lines) {
                if (line === "" || line.length < settings.minWordLength)
                    continue;

                let list = this.wordMap.get(line.charAt(0));
                if (!list) {
                    list = [];
                    this.wordMap.set(line.charAt(0), list);
                }

                list.push(line.trim());
            }
        }

        let count = 0;
        // Sort by length
        for (let entry of this.wordMap.entries()) {
            const newValue = SuggestionBlacklist.filterText(entry[1].sort((a, b) => a.length - b.length));
            this.wordMap.set(entry[0], newValue);
            count += newValue.length;
        }

        return count;
    }

    async deleteWordList(vault: Vault, path: string) {
        await vault.adapter.remove(path);
    }

    async importWordList(vault: Vault, name: string, text: string): Promise<boolean> {
        const path = intoCompletrPath(vault, WORD_LISTS_FOLDER_PATH, name);
        if (await vault.adapter.exists(path))
            return false;

        await vault.adapter.write(path, text);
        return true;
    }

    /**
     * Returns all files inside of {@link BASE_FOLDER_PATH}. The resulting strings are full paths, relative to the vault
     * root. <br>
     * @example
     * - .obsidian/plugins/obsidian-completr/wordLists/german.dic
     * - .obsidian/plugins/obsidian-completr/wordLists/long_words
     * - .obsidian/plugins/obsidian-completr/wordLists/special_words.txt
     * @param vault
     */
    async getRelativeFilePaths(vault: Vault): Promise<string[]> {
        const path = intoCompletrPath(vault, WORD_LISTS_FOLDER_PATH);
        if (!(await vault.adapter.exists(path)))
            await vault.adapter.mkdir(path);

        return (await vault.adapter.list(path)).files;
    }
}

export const WordList = new WordListSuggestionProvider();
