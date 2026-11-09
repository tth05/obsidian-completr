/**
 * Pure text helpers without any dependency on Obsidian or CodeMirror.
 */

/** Matches letters and combining marks of every script (Latin, Greek, Cyrillic, Devanagari, CJK, ...). */
export const DEFAULT_CHARACTER_REGEX = "\\p{L}\\p{M}";
/** The default used up to v3. Settings still containing it are migrated to {@link DEFAULT_CHARACTER_REGEX}. */
export const LEGACY_CHARACTER_REGEX = "a-zA-ZöäüÖÄÜß";

/**
 * Compiles the user supplied character class content (e.g. `a-zA-Z`) into a regex matching a single character.
 * Returns null if it is invalid.
 */
export function compileCharacterClass(characterClass: string, flags = "u"): RegExp | null {
    try {
        return new RegExp("[" + characterClass + "]", flags);
    } catch {
        return null;
    }
}

export interface WordMatch {
    /** The word directly in front of the given position. */
    query: string;
    /** The character in front of the word, null if the word starts at the beginning of the line or the look back limit. */
    separatorChar: string | null;
}

/**
 * Finds the word ending at `ch` in `line`. Iterates by code point, so characters outside the BMP work as well.
 */
export function matchWordBackwards(
    line: string,
    ch: number,
    isWordChar: (char: string) => boolean,
    maxLookBackDistance = 50,
): WordMatch {
    const limit = Math.max(0, ch - maxLookBackDistance);
    let start = Math.min(ch, line.length);
    while (start > limit) {
        let charStart = start - 1;
        const code = line.charCodeAt(charStart);
        // Low surrogate -> include the high surrogate in front of it
        if (code >= 0xdc00 && code <= 0xdfff && charStart > 0) {
            const high = line.charCodeAt(charStart - 1);
            if (high >= 0xd800 && high <= 0xdbff) charStart--;
        }

        const char = line.substring(charStart, start);
        if (!isWordChar(char)) return { query: line.substring(start, ch), separatorChar: char };
        start = charStart;
    }

    return { query: line.substring(start, ch), separatorChar: null };
}

// Only the "Combining Diacritical Marks" block. Other marks (e.g. Devanagari vowel signs) are essential to the script.
const DIACRITICS_REGEX = /[̀-ͯ]/g;

/** Removes diacritics after decomposition, e.g. "Hèllò" -> "Hello". */
export function removeDiacritics(str: string): string {
    return str.normalize("NFD").replace(DIACRITICS_REGEX, "").normalize("NFC");
}

export function maybeLowerCase(str: string, lowerCase: boolean): string {
    return lowerCase ? str.toLowerCase() : str;
}

/**
 * Used by the "append" insertion modes: Keeps the casing the user typed, but takes everything else (diacritics, the
 * rest of the word) from the suggested word. E.g. typed "ASI" + word "āṣīṛū" -> "ĀṢĪṛū".
 */
export function applyTypedCasing(typed: string, word: string): string {
    const typedChars = Array.from(typed.normalize("NFC"));
    const wordChars = Array.from(word.normalize("NFC"));
    let result = "";
    for (let i = 0; i < wordChars.length; i++) {
        const w = wordChars[i];
        const t = typedChars[i];
        if (t === undefined || t === w) {
            result += w;
            continue;
        }

        // Typed char differs. Keep the typed casing applied to the word's char.
        const isUpper = t !== t.toLowerCase();
        const isLower = t !== t.toUpperCase();
        result += isUpper ? w.toUpperCase() : isLower ? w.toLowerCase() : w;
    }
    return result;
}

export interface FrontMatterBounds {
    /** Line of the opening `---`, always 0. */
    startLine: number;
    /** Line of the closing `---` or `...`. */
    endLine: number;
}

/**
 * Finds the YAML front matter block, which Obsidian only recognizes at the very start of a note.
 * @param maxLines how far to look for the closing delimiter.
 */
export function findFrontMatterBounds(
    getLine: (line: number) => string,
    lineCount: number,
    maxLines = 1000,
): FrontMatterBounds | null {
    if (lineCount < 2 || getLine(0).trimEnd() !== "---") return null;

    const end = Math.min(lineCount, maxLines);
    for (let i = 1; i < end; i++) {
        const line = getLine(i).trimEnd();
        if (line === "---" || line === "...") return { startLine: 0, endLine: i };
    }

    return null;
}

/**
 * Checks whether `ch` is inside an unclosed inline math block (`$...`) on the given line, looking only at the text in
 * front of the cursor. Escaped dollars and (if `skipInlineCode` is set) inline code are skipped. `$$` pairs are ignored
 * here, those are handled by the syntax tree.
 */
export function isInUnclosedInlineMath(line: string, ch: number, skipInlineCode = true): boolean {
    let open = false;
    let inCode = 0; // length of the backtick run that opened the current inline code span, 0 if none
    for (let i = 0; i < ch && i < line.length; i++) {
        const c = line[i];
        if (c === "\\") {
            i++;
            continue;
        }

        if (c === "`" && skipInlineCode) {
            let run = 1;
            while (line[i + run] === "`") run++;
            if (!open) {
                if (inCode === 0) inCode = run;
                else if (inCode === run) inCode = 0;
            }
            i += run - 1;
            continue;
        }

        if (c !== "$" || inCode !== 0) continue;
        if (line[i + 1] === "$") {
            // Skip display math delimiters
            i++;
            continue;
        }

        open = !open;
    }

    return open;
}

/**
 * The leading part of a line that has to be repeated on continuation lines: indentation, block quote markers and list
 * item indentation (but not the list marker itself). E.g. "> - text" -> ">   ".
 */
export function getContinuationPrefix(line: string): string {
    const match = /^([ \t]*(?:>[ \t]?)*)([ \t]*)((?:[-*+]|\d+[.)])[ \t]+)?/.exec(line);
    if (!match) return "";
    const [, quotes = "", indentation = "", listMarker = ""] = match;
    return quotes + indentation + " ".repeat(listMarker.length);
}
