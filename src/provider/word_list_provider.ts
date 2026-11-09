import { type DataFiles, splitLines } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import { WordIndex } from "../word_index.ts";
import type { SuggestionBlacklist } from "./blacklist.ts";
import { DictionaryProvider } from "./dictionary_provider.ts";

export const WORD_LISTS_FOLDER = "wordLists";

/** Suggests the words from the files in the `wordLists` folder of the plugin, one word per line. */
export class WordListProvider extends DictionaryProvider {
    readonly id = "word-list";
    readonly icon = "book-open";

    private readonly index = new WordIndex();

    constructor(
        private readonly files: DataFiles,
        private readonly blacklist: SuggestionBlacklist,
    ) {
        super();
    }

    get wordCount(): number {
        return this.index.size;
    }

    protected isEnabled(settings: CompletrSettings): boolean {
        return settings.wordListProviderEnabled;
    }

    protected getIndex(): WordIndex {
        return this.index;
    }

    /** (Re)loads all word lists. Returns the number of loaded words. */
    async load(settings: CompletrSettings): Promise<number> {
        const words: string[] = [];
        for (const path of await this.getFilePaths()) {
            let data: string;
            try {
                data = await this.files.readPath(path);
            } catch (e) {
                console.warn("Completr: Unable to read word list " + path, e);
                continue;
            }

            for (const line of splitLines(data)) {
                const word = line.trim();
                if (word.length >= settings.minWordLength && !this.blacklist.has(word)) words.push(word);
            }
        }

        this.index.setAll(words);
        return this.index.size;
    }

    removeWord(word: string) {
        this.index.delete(word);
    }

    /** Vault relative paths of all word list files. */
    getFilePaths(): Promise<string[]> {
        return this.files.list(WORD_LISTS_FOLDER);
    }

    /** Returns false if a list with this name already exists. */
    async importWordList(name: string, text: string): Promise<boolean> {
        const file = WORD_LISTS_FOLDER + "/" + name;
        if (await this.files.exists(file)) return false;
        await this.files.write(file, text);
        return true;
    }

    async deleteWordList(path: string) {
        await this.files.removePath(path);
    }
}
