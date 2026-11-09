import { type DataFiles, splitLines } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import { WordIndex } from "../word_index.ts";
import type { SuggestionBlacklist } from "./blacklist.ts";
import { DictionaryProvider, getNormalization } from "./dictionary_provider.ts";

const SCANNED_WORDS_FILE = "scanned_words.txt";
const SAVE_DELAY_MS = 2000;

const regexCache = new Map<string, RegExp>();

/**
 * Builds the regex used to find words. Math, code, URLs and link destinations are matched too, but without a capture
 * group, so they are skipped.
 */
function getScanRegex(characterRegex: string): RegExp {
    let regex = regexCache.get(characterRegex);
    if (!regex) {
        const skip = [
            "\\$+[^$]*?\\$+", // math
            "`+[\\s\\S]*?`+", // code
            "https?:\\/\\/[^\\s)\\]>]+", // URLs
            "\\]\\([^)\\n]*\\)", // markdown link destinations
        ].join("|");
        try {
            regex = new RegExp(`${skip}|([${characterRegex}]+)`, "gu");
        } catch {
            regex = new RegExp(`${skip}|([\\p{L}\\p{M}]+)`, "gu");
        }
        regexCache.set(characterRegex, regex);
    }
    regex.lastIndex = 0;
    return regex;
}

/** Extracts the words from a markdown text. `excludeOffset` skips the word touching this offset (being typed). */
export function scanWords(text: string, settings: CompletrSettings, excludeOffset = -1): string[] {
    const words: string[] = [];
    for (const match of text.matchAll(getScanRegex(settings.characterRegex))) {
        const word = match[1];
        if (!word || word.length < settings.minWordLength) continue;
        if (excludeOffset >= match.index && excludeOffset <= match.index + word.length) continue;
        words.push(word);
    }
    return words;
}

/**
 * Suggests words found in the vault's notes. Words of the active note are picked up live while typing, the whole vault
 * can be scanned from the settings.
 */
export class FileScannerProvider extends DictionaryProvider {
    readonly id = "file-scanner";
    readonly icon = "file-search";

    private readonly index = new WordIndex();
    /** The words of the note that is currently being edited. */
    private readonly currentFileIndex = new WordIndex();
    private saveTimer: number | null = null;
    private dirty = false;

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
        return settings.fileScannerProviderEnabled;
    }

    protected getIndex(_: unknown, settings: CompletrSettings): WordIndex {
        return settings.fileScannerCurrentFileOnly ? this.currentFileIndex : this.index;
    }

    /** Adds the words of a note to the known words. */
    addText(text: string, settings: CompletrSettings) {
        let changed = false;
        for (const word of scanWords(text, settings)) {
            if (!this.blacklist.has(word) && this.index.add(word)) changed = true;
        }
        if (changed) this.scheduleSave();
    }

    /**
     * Replaces the words of the current note. They are also added to the known words, unless only the current file
     * should be used.
     */
    setCurrentFileText(text: string, settings: CompletrSettings, cursorOffset = -1) {
        const words = scanWords(text, settings, cursorOffset).filter((w) => !this.blacklist.has(w));
        this.currentFileIndex.setAll(words);
        if (!settings.fileScannerScanCurrent) return;

        let changed = false;
        for (const word of words) if (this.index.add(word)) changed = true;
        if (changed) this.scheduleSave();
    }

    removeWord(word: string) {
        this.currentFileIndex.delete(word);
        if (this.index.delete(word)) this.scheduleSave();
    }

    async deleteAllWords() {
        this.index.clear();
        this.currentFileIndex.clear();
        this.dirty = true;
        await this.flush();
    }

    async load(settings: CompletrSettings) {
        const contents = await this.files.read(SCANNED_WORDS_FILE);
        if (contents === null) return;
        this.index.setAll(splitLines(contents).filter((w) => w && !this.blacklist.has(w)));
        this.index.prepare(getNormalization(settings));
    }

    private scheduleSave() {
        this.dirty = true;
        if (this.saveTimer !== null) return;
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, SAVE_DELAY_MS);
    }

    /** Writes pending changes to disk. */
    async flush() {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.dirty) return;
        this.dirty = false;
        await this.files.write(SCANNED_WORDS_FILE, Array.from(this.index.values()).join("\n"));
    }
}
