import { DEFAULT_CHARACTER_REGEX, LEGACY_CHARACTER_REGEX } from "./text.ts";

export enum WordInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append",
}

export enum CalloutProviderSource {
    COMPLETR = "Completr",
    CALLOUT_MANAGER = "Callout Manager",
}

export enum SortOrder {
    SHORTEST_FIRST = "shortest",
    LONGEST_FIRST = "longest",
    ALPHABETICAL = "alphabetical",
}

export enum IconMode {
    /** Only suggestions that come with their own icon (e.g. callouts) show one. */
    SUGGESTION = "suggestion",
    /** The suggestion's own icon, or the icon of the provider it comes from. */
    SUGGESTION_OR_PROVIDER = "provider",
    NONE = "none",
}

export interface CompletrSettings {
    /** Bumped whenever a migration is needed. */
    settingsVersion: number;

    characterRegex: string;
    maxLookBackDistance: number;
    autoFocus: boolean;
    autoTrigger: boolean;
    /** Tab inserts the selected suggestion (Obsidian's hotkey settings can't bind a plain Tab). */
    insertWithTab: boolean;
    /** Tab jumps to the next snippet placeholder. */
    jumpWithTab: boolean;
    minWordLength: number;
    minWordTriggerLength: number;
    wordInsertionMode: WordInsertionMode;
    ignoreDiacriticsWhenFiltering: boolean;
    fuzzyMatching: boolean;
    sortOrder: SortOrder;
    /** BCP 47 tag used for alphabetical sorting, empty for Obsidian's language. */
    sortLocale: string;
    insertSpaceAfterWord: boolean;
    /** Disables the word providers (file scanner, word lists) inside code blocks and inline code. */
    disableWordsInCode: boolean;
    iconMode: IconMode;
    rankByUsage: boolean;

    snippetsEnabled: boolean;

    latexProviderEnabled: boolean;
    latexBuiltInCommands: boolean;
    latexTriggerInCodeBlocks: boolean;
    latexMinWordTriggerLength: number;
    latexIgnoreCase: boolean;
    /** Render LaTeX suggestions next to their source in the popup. */
    latexPreview: boolean;

    fileScannerProviderEnabled: boolean;
    fileScannerScanCurrent: boolean;
    /** Only suggest words from the currently open file. */
    fileScannerCurrentFileOnly: boolean;

    wordListProviderEnabled: boolean;

    frontMatterProviderEnabled: boolean;
    frontMatterTagAppendSuffix: boolean;
    frontMatterIgnoreCase: boolean;

    calloutProviderEnabled: boolean;
    calloutProviderSource: CalloutProviderSource;
}

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: CompletrSettings = {
    settingsVersion: SETTINGS_VERSION,

    characterRegex: DEFAULT_CHARACTER_REGEX,
    maxLookBackDistance: 50,
    autoFocus: true,
    autoTrigger: true,
    insertWithTab: false,
    jumpWithTab: false,
    minWordLength: 2,
    minWordTriggerLength: 3,
    wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE,
    ignoreDiacriticsWhenFiltering: false,
    fuzzyMatching: false,
    sortOrder: SortOrder.SHORTEST_FIRST,
    sortLocale: "",
    insertSpaceAfterWord: false,
    disableWordsInCode: false,
    iconMode: IconMode.SUGGESTION,
    rankByUsage: true,

    snippetsEnabled: true,

    latexProviderEnabled: true,
    latexBuiltInCommands: true,
    latexTriggerInCodeBlocks: true,
    latexMinWordTriggerLength: 2,
    latexIgnoreCase: false,
    latexPreview: true,

    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    fileScannerCurrentFileOnly: false,

    wordListProviderEnabled: true,

    frontMatterProviderEnabled: true,
    frontMatterTagAppendSuffix: true,
    frontMatterIgnoreCase: true,

    calloutProviderEnabled: true,
    calloutProviderSource: CalloutProviderSource.COMPLETR,
};

/**
 * Builds the settings from the saved data, filling in defaults and migrating old values. Unknown keys from old versions
 * are dropped.
 */
export function loadSettings(data: unknown): { settings: CompletrSettings; migratedFrom: number | null } {
    const saved = (data && typeof data === "object" ? data : {}) as Partial<CompletrSettings> & Record<string, unknown>;
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CompletrSettings)[]) {
        const value = saved[key];
        if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
            (settings as Record<string, unknown>)[key] = value;
        }
    }

    // Data written before settings versions existed is version 1. A fresh install has no data at all.
    const version = data ? (typeof saved.settingsVersion === "number" ? saved.settingsVersion : 1) : SETTINGS_VERSION;
    if (version < 2) {
        // v4.0.0: Unicode aware default word characters
        if (saved.characterRegex === LEGACY_CHARACTER_REGEX) settings.characterRegex = DEFAULT_CHARACTER_REGEX;
    }
    settings.settingsVersion = SETTINGS_VERSION;

    return { settings, migratedFrom: version < SETTINGS_VERSION ? version : null };
}
