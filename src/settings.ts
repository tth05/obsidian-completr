export const enum WordListInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append"
}

export interface CompletrSettings {
    wordSeparators: string,
    maxLookBackDistance: number,
    minWordLength: number,
    latexProviderEnabled: boolean,
    fileScannerProviderEnabled: boolean,
    fileScannerScanCurrent: boolean,
    fileScannerCharacterRegex: string,
    wordListProviderEnabled: boolean,
    wordListFiles: string[],
    wordListInsertionMode: WordListInsertionMode,
}

export const DEFAULT_SETTINGS: CompletrSettings = {
    wordSeparators: " ,.[]{}()$*+-/\?|&#´'`\"^=:_<>%",
    maxLookBackDistance: 50,
    minWordLength: 6,
    latexProviderEnabled: true,
    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    fileScannerCharacterRegex: "a-zA-ZöäüÖÄÜß",
    wordListProviderEnabled: true,
    wordListFiles: [],
    wordListInsertionMode: WordListInsertionMode.IGNORE_CASE_REPLACE,
}

