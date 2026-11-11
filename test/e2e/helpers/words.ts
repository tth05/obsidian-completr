/**
 * Helpers for the word providers (file scanner, word lists). All of them run inside Obsidian via `eval`.
 */
import type { Obsidian } from "../harness/obsidian.ts";

interface WordIndexLike {
    has(word: string): boolean;
    delete(word: string): boolean;
}

/** The private word indices of the file scanner. */
interface ScannerInternals {
    index: WordIndexLike;
    currentFileIndex: WordIndexLike;
}

/** Writes a word list into the plugin's `wordLists` folder and reloads all word lists. */
export async function setWordList(obsidian: Obsidian, name: string, words: string[]) {
    await obsidian.eval(
        async (name: string, content: string) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.wordList.getFileNames(); // creates the folder
            await plugin.files.write("wordLists/" + name, content);
            await plugin.wordList.load(plugin.settings);
        },
        name,
        words.join("\n"),
    );
}

/** Deletes the given word lists (if they exist) and reloads the remaining ones. */
export async function removeWordLists(obsidian: Obsidian, ...names: string[]) {
    await obsidian.eval(async (names: string[]) => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        for (const name of names) await plugin.files.remove("wordLists/" + name);
        await plugin.wordList.load(plugin.settings);
    }, names);
}

/** Whether the file scanner knows the word (vault wide index). */
export function isScanned(obsidian: Obsidian, word: string): Promise<boolean> {
    return obsidian.eval((word: string) => {
        const scanner = app.plugins.plugins["obsidian-completr"]!.fileScanner as unknown as ScannerInternals;
        return scanner.index.has(word);
    }, word);
}

/** Number of words the file scanner knows. */
export function scannedWordCount(obsidian: Obsidian): Promise<number> {
    return obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.fileScanner.wordCount);
}

export function waitForScanned(obsidian: Obsidian, word: string, timeout = 3_000) {
    return obsidian.waitFor(() => isScanned(obsidian, word), { timeout, what: `"${word}" to be scanned` });
}

/**
 * Forgets the given scanned words, so tests don't influence each other. The plugin itself can only forget all words,
 * which would also drop the ones other test files rely on, so this reaches into the scanner's indices.
 */
export async function forgetScannedWords(obsidian: Obsidian, words: string[]) {
    await obsidian.eval((words: string[]) => {
        const scanner = app.plugins.plugins["obsidian-completr"]!.fileScanner as unknown as ScannerInternals;
        for (const w of words) {
            scanner.index.delete(w);
            scanner.currentFileIndex.delete(w);
        }
    }, words);
}

/** Resets the usage counts of the given suggestions. */
export async function forgetUsage(obsidian: Obsidian, displayNames: string[]) {
    await obsidian.eval((names: string[]) => {
        const usage = app.plugins.plugins["obsidian-completr"]!.usage as unknown as { counts: Map<string, number> };
        for (const n of names) usage.counts.delete(n);
    }, displayNames);
}

export interface RenderedItem {
    text: string;
    /** Texts of the highlighted (matched) parts. */
    highlights: string[];
    /** Class list of the icon's svg, null if there is no icon. */
    iconClass: string | null;
    /** Value of the `--completr-suggestion-color` property of the item. */
    color: string;
    /** The muted text next to the name (what a snippet inserts), null if there is none. */
    detail: string | null;
}

/** Details of the rendered popup items. */
export function renderedItems(obsidian: Obsidian): Promise<RenderedItem[]> {
    return obsidian.eval(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".suggestion-container .completr-suggestion-item")).map(
            (el) => {
                const text = el.querySelector(".completr-suggestion-text");
                return {
                    text: text?.textContent ?? "",
                    highlights: Array.from(text?.querySelectorAll(".suggestion-highlight") ?? []).map(
                        (h) => h.textContent ?? "",
                    ),
                    iconClass: el.querySelector(".completr-suggestion-icon svg")?.getAttribute("class") ?? null,
                    color: el.style.getPropertyValue("--completr-suggestion-color"),
                    detail: el.querySelector(".completr-suggestion-detail")?.textContent ?? null,
                };
            },
        ),
    );
}

/**
 * Creates (or overwrites) a file through the vault without opening it, so Obsidian knows about it right away. Files
 * written through the adapter only show up once the file watcher noticed them.
 */
export async function createVaultFile(obsidian: Obsidian, path: string, content: string) {
    await obsidian.eval(
        async (path: string, content: string) => {
            const existing = app.vault.getFileByPath(path);
            if (existing) await app.vault.modify(existing, content);
            else await app.vault.create(path, content);
        },
        path,
        content,
    );
}

/** Deletes notes (vault relative paths) if they exist. */
export async function deleteNotes(obsidian: Obsidian, paths: string[]) {
    await obsidian.eval(async (paths: string[]) => {
        for (const path of paths) {
            const file = app.vault.getFileByPath(path);
            if (file) await app.vault.delete(file);
        }
    }, paths);
}
