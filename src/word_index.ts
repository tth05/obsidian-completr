import { removeDiacritics } from "./text.ts";

export interface NormalizationOptions {
    ignoreCase: boolean;
    ignoreDiacritics: boolean;
}

export interface SearchOptions extends NormalizationOptions {
    /** Also return words containing the query's characters in order, e.g. "mkd" -> "markdown". */
    fuzzy: boolean;
    /** Upper bound for the number of fuzzy matches to collect. Prefix matches are never limited. */
    fuzzyLimit?: number;
}

export interface WordMatch {
    word: string;
    /** True if the word starts with the query, false for fuzzy matches. */
    isPrefixMatch: boolean;
    /** Fuzzy matches only: higher is better. */
    score: number;
    /** [start, end) ranges of matched characters (UTF-16 offsets into {@link word}), used for highlighting. */
    matches: [number, number][];
}

/** Separates the normalized key from the original word inside an entry. Sorts before every other character. */
const SEPARATOR = "\u0000";

/**
 * All words of the index, normalized and sorted. An entry is the normalized word (the key), followed by
 * {@link SEPARATOR} and the original word if they differ. Because the separator sorts first, sorting the entries sorts
 * by key, and an entry starts with a query exactly if its key does. This keeps a view to a single array of mostly
 * shared strings, which can be sorted natively (fast, even for millions of words).
 */
interface View {
    opts: NormalizationOptions;
    entries: string[];
}

function normalize(word: string, opts: NormalizationOptions): string {
    let key = opts.ignoreCase ? word.toLowerCase() : word;
    if (opts.ignoreDiacritics) key = removeDiacritics(key);
    return key;
}

function toEntry(word: string, opts: NormalizationOptions): string {
    const key = normalize(word, opts);
    return key === word ? word : key + SEPARATOR + word;
}

function keyLength(entry: string): number {
    const sep = entry.indexOf(SEPARATOR);
    return sep === -1 ? entry.length : sep;
}

function entryWord(entry: string): string {
    const sep = entry.indexOf(SEPARATOR);
    return sep === -1 ? entry : entry.substring(sep + 1);
}

function viewMode(opts: NormalizationOptions): string {
    return (opts.ignoreCase ? "i" : "") + (opts.ignoreDiacritics ? "d" : "");
}

/** First index in the sorted array with arr[i] >= value. */
function lowerBound(arr: readonly string[], value: string): number {
    let lo = 0,
        hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Matches `query` as a subsequence of the first `length` characters of `key`. Returns the matched ranges and a score
 * (higher is better), or null. Consecutive matches score higher, gaps lower.
 */
export function fuzzyMatch(
    query: string,
    key: string,
    length = key.length,
): { score: number; matches: [number, number][] } | null {
    if (query.length === 0) return { score: 0, matches: [] };
    if (key[0] !== query[0]) return null;

    const matches: [number, number][] = [];
    let score = 0;
    let q = 0;
    let lastMatch = -2;
    for (let i = 0; i < length && q < query.length; i++) {
        if (key[i] !== query[q]) continue;

        if (lastMatch === i - 1 && matches.length > 0) {
            matches[matches.length - 1][1] = i + 1;
            score += 2;
        } else {
            matches.push([i, i + 1]);
            if (lastMatch >= 0) score -= 1;
        }
        lastMatch = i;
        q++;
    }

    if (q < query.length) return null;
    // Prefer shorter words
    score -= (length - query.length) * 0.01;
    return { score, matches };
}

/**
 * A set of words which can quickly be searched by prefix. For every combination of normalization options a sorted view
 * is built on first use (or ahead of time with {@link prepare}) and kept up to date incrementally afterwards.
 */
export class WordIndex {
    private readonly words = new Set<string>();
    private readonly views = new Map<string, View>();

    get size(): number {
        return this.words.size;
    }

    has(word: string): boolean {
        return this.words.has(word);
    }

    values(): IterableIterator<string> {
        return this.words.values();
    }

    /** Adds a word, returns true if it was not already known. */
    add(word: string): boolean {
        if (!word || this.words.has(word)) return false;
        this.words.add(word);

        for (const view of this.views.values()) {
            const entry = toEntry(word, view.opts);
            view.entries.splice(lowerBound(view.entries, entry), 0, entry);
        }
        return true;
    }

    /** Replaces all words. Much faster than adding them one by one. */
    setAll(words: Iterable<string>) {
        this.words.clear();
        for (const w of words) if (w) this.words.add(w);
        this.views.clear();
    }

    delete(word: string): boolean {
        if (!this.words.delete(word)) return false;
        for (const view of this.views.values()) {
            const entry = toEntry(word, view.opts);
            const i = lowerBound(view.entries, entry);
            if (view.entries[i] === entry) view.entries.splice(i, 1);
        }
        return true;
    }

    clear() {
        this.words.clear();
        this.views.clear();
    }

    /** Builds the view for the given options now, so the first search doesn't have to. */
    prepare(opts: NormalizationOptions) {
        this.getView(opts);
    }

    private getView(opts: NormalizationOptions): View {
        const mode = viewMode(opts);
        let view = this.views.get(mode);
        if (!view) {
            const normalization = { ignoreCase: opts.ignoreCase, ignoreDiacritics: opts.ignoreDiacritics };
            const entries = Array.from(this.words, (w) => toEntry(w, normalization));
            // Default sort compares UTF-16 code units, like `<` does. Much faster than a custom comparator.
            entries.sort();
            view = { opts: normalization, entries };
            this.views.set(mode, view);
        }
        return view;
    }

    /**
     * Returns all words starting with `query` (after normalization), followed by fuzzy matches if enabled. An empty
     * query returns all words.
     */
    search(query: string, opts: SearchOptions): WordMatch[] {
        const { entries } = this.getView(opts);
        const q = normalize(query, opts);
        const result: WordMatch[] = [];
        const prefixRange: [number, number][] = q.length > 0 ? [[0, query.length]] : [];

        const start = lowerBound(entries, q);
        let end = start;
        for (; end < entries.length && entries[end].startsWith(q); end++) {
            result.push({ word: entryWord(entries[end]), isPrefixMatch: true, score: 0, matches: prefixRange });
        }

        if (!opts.fuzzy || q.length < 2) return result;

        // Fuzzy matches have to start with the same character, so only the range of keys starting with it is scanned.
        const firstChar = q[0];
        const fuzzyLimit = opts.fuzzyLimit ?? 200;
        const fuzzy: WordMatch[] = [];
        for (let i = lowerBound(entries, firstChar); i < entries.length; i++) {
            const entry = entries[i];
            if (entry[0] !== firstChar) break;
            if (i >= start && i < end) continue; // already a prefix match

            const length = keyLength(entry);
            const m = fuzzyMatch(q, entry, length);
            if (!m) continue;
            // Match positions refer to the normalized key. They are only reliable for highlighting if normalization
            // did not change the length.
            const word = entryWord(entry);
            fuzzy.push({
                word,
                isPrefixMatch: false,
                score: m.score,
                matches: length === word.length ? m.matches : [],
            });
        }

        fuzzy.sort((a, b) => b.score - a.score);
        if (fuzzy.length > fuzzyLimit) fuzzy.length = fuzzyLimit;
        return result.concat(fuzzy);
    }
}
