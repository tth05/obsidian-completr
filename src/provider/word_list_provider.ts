import { type DataFiles, splitLines } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import { WordIndex } from "../word_index.ts";
import { DictionaryProvider, getNormalization } from "./dictionary_provider.ts";

export const WORD_LISTS_FOLDER = "wordLists";

/** Suggests the words from the files in the `wordLists` folder of the plugin, one word per line. */
export class WordListProvider extends DictionaryProvider {
    readonly id = "word-list";
    readonly icon = "book-open";

    private readonly index = new WordIndex();

    constructor(private readonly files: DataFiles) {
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
        for (const name of await this.getFileNames()) {
            let data: string | null;
            try {
                data = await this.files.read(WORD_LISTS_FOLDER + "/" + name);
            } catch (e) {
                console.warn("Completr: Unable to read word list " + name, e);
                continue;
            }

            for (const line of splitLines(data ?? "")) {
                const word = line.trim();
                if (word) words.push(word);
            }
        }

        this.index.setAll(words);
        // Sorting a big list takes a moment, better now than on the first keystroke
        this.index.prepare(getNormalization(settings));
        return this.index.size;
    }

    /** The names of all word list files. */
    async getFileNames(): Promise<string[]> {
        const names = await this.files.list(WORD_LISTS_FOLDER);
        return names.map((name) => name.substring(name.lastIndexOf("/") + 1));
    }

    /** Returns false if a list with this name already exists. */
    async importWordList(name: string, text: string): Promise<boolean> {
        const file = WORD_LISTS_FOLDER + "/" + name;
        if (await this.files.exists(file)) return false;
        await this.files.write(file, text);
        return true;
    }

    async deleteWordList(name: string) {
        await this.files.remove(WORD_LISTS_FOLDER + "/" + name);
    }
}
