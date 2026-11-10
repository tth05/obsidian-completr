import type { TFile, Vault } from "obsidian";
import { type DataFiles, DebouncedSaver, splitLines } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import { DEFAULT_CHARACTER_REGEX } from "../text.ts";
import { WordIndex } from "../word_index.ts";
import { DictionaryProvider, getNormalization } from "./dictionary_provider.ts";

const SCANNED_WORDS_FILE = "scanned_words.txt";
const SAVE_DELAY_MS = 2000;

const regexCache = new Map<string, RegExp>();

/**
 * Builds the regex used to find words. Math, code, URLs and link destinations are matched too, but not as the "word"
 * group, so they are skipped.
 */
function getScanRegex(characterRegex: string): RegExp {
    let regex = regexCache.get(characterRegex);
    if (!regex) {
        const skip = [
            "\\$\\$[\\s\\S]*?\\$\\$", // display math
            "\\$(?!\\s)[^$\\n]*?(?<!\\s)\\$", // inline math, like Obsidian: "$5 and $6" is not math
            "(`+)[\\s\\S]*?\\1", // code, closed by a backtick run of the same length
            "https?:\\/\\/[^\\s)\\]>]+", // URLs
            "\\]\\([^)\\n]*\\)", // markdown link destinations
        ].join("|");
        try {
            regex = new RegExp(`${skip}|(?<word>[${characterRegex}]+)`, "gu");
        } catch {
            regex = new RegExp(`${skip}|(?<word>[${DEFAULT_CHARACTER_REGEX}]+)`, "gu");
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
        const word = match.groups?.word;
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
    private readonly saver: DebouncedSaver;

    constructor(private readonly files: DataFiles) {
        super();
        this.saver = new DebouncedSaver(
            () => files.write(SCANNED_WORDS_FILE, Array.from(this.index.values()).join("\n")),
            SAVE_DELAY_MS,
        );
    }

    get wordCount(): number {
        return this.index.size;
    }

    protected isEnabled(settings: CompletrSettings): boolean {
        return settings.fileScannerProviderEnabled;
    }

    protected getIndex(settings: CompletrSettings): WordIndex {
        return settings.fileScannerCurrentFileOnly ? this.currentFileIndex : this.index;
    }

    /** Adds the words of a note to the known words. */
    addText(text: string, settings: CompletrSettings) {
        if (this.index.addAll(scanWords(text, settings)) > 0) this.saver.schedule();
    }

    /** Learns the words of the given notes. Returns how many notes could be read. */
    async scanFiles(vault: Vault, files: TFile[], settings: CompletrSettings): Promise<number> {
        let scanned = 0;
        for (const file of files) {
            try {
                this.addText(await vault.cachedRead(file), settings);
                scanned++;
            } catch (e) {
                console.warn("Completr: Unable to scan " + file.path, e);
            }
        }
        await this.flush();
        return scanned;
    }

    /**
     * Replaces the words of the current note. They are also added to the known words, unless only the current file
     * should be used.
     */
    setCurrentFileText(text: string, settings: CompletrSettings, cursorOffset = -1) {
        if (!settings.fileScannerProviderEnabled) return;
        const words = scanWords(text, settings, cursorOffset);
        this.currentFileIndex.setAll(words);
        if (settings.fileScannerScanCurrent && this.index.addAll(words) > 0) this.saver.schedule();
    }

    async deleteAllWords() {
        this.index.clear();
        this.currentFileIndex.clear();
        this.saver.schedule();
        await this.flush();
    }

    async load(settings: CompletrSettings) {
        const contents = await this.files.read(SCANNED_WORDS_FILE);
        if (contents === null) return;
        this.index.setAll(splitLines(contents));
        this.index.prepare(getNormalization(settings));
    }

    /** Writes pending changes to disk. */
    flush(): Promise<void> {
        return this.saver.flush();
    }
}
