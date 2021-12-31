export const enum WordInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append"
}

export interface CompletrSettings {
    characterRegex: string,
    maxLookBackDistance: number,
    minWordLength: number,
    wordInsertionMode: WordInsertionMode,
    latexProviderEnabled: boolean,
    fileScannerProviderEnabled: boolean,
    fileScannerScanCurrent: boolean,
    wordListProviderEnabled: boolean,
}

export const DEFAULT_SETTINGS: CompletrSettings = {
    characterRegex: "a-zA-ZöäüÖÄÜß",
    maxLookBackDistance: 50,
    minWordLength: 6,
    wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE,
    latexProviderEnabled: true,
    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    wordListProviderEnabled: true,
}
