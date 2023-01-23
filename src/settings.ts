import { Vault } from "obsidian";

export const enum WordInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append"
}

export interface CompletrSettings {
    characterRegex: string,
    maxLookBackDistance: number,
    autoFocus: boolean,
    autoTrigger: boolean,
    minWordLength: number,
    minWordTriggerLength: number,
    wordInsertionMode: WordInsertionMode,
    ignoreDiacriticsWhenFiltering: boolean,
    latexProviderEnabled: boolean,
    latexTriggerInCodeBlocks: boolean,
    latexMinWordTriggerLength: number,
    latexIgnoreCase: boolean,
    fileScannerProviderEnabled: boolean,
    fileScannerScanCurrent: boolean,
    wordListProviderEnabled: boolean,
    frontMatterProviderEnabled: boolean,
    frontMatterTagAppendSuffix: boolean,
    frontMatterIgnoreCase: boolean,
    calloutProviderEnabled: boolean,
}

export const DEFAULT_SETTINGS: CompletrSettings = {
    characterRegex: "a-zA-ZöäüÖÄÜß",
    maxLookBackDistance: 50,
    autoFocus: true,
    autoTrigger: true,
    minWordLength: 2,
    minWordTriggerLength: 3,
    wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE,
    ignoreDiacriticsWhenFiltering: false,
    latexProviderEnabled: true,
    latexTriggerInCodeBlocks: true,
    latexMinWordTriggerLength: 2,
    latexIgnoreCase: false,
    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    wordListProviderEnabled: true,
    frontMatterProviderEnabled: true,
    frontMatterTagAppendSuffix: true,
    frontMatterIgnoreCase: true,
    calloutProviderEnabled: true,
}

export function intoCompletrPath(vault: Vault, ...path: string[]): string {
    return vault.configDir + "/plugins/obsidian-completr/" + path.join("/");
}
