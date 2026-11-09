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

interface View {
    opts: NormalizationOptions;
    /** Normalized words, sorted. */
    keys: string[];
    /** words[i] is the original word of keys[i]. */
    words: string[];
}

function normalize(word: string, opts: NormalizationOptions): string {
    let key = opts.ignoreCase ? word.toLowerCase() : word;
    if (opts.ignoreDiacritics) key = removeDiacritics(key);
    return key;
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
 * Matches `query` as a subsequence of `key`. Returns the matched ranges and a score (higher is better), or null.
 * Consecutive matches and matches at word starts score higher, gaps score lower.
 */
export function fuzzyMatch(query: string, key: string): { score: number; matches: [number, number][] } | null {
    if (query.length === 0) return { score: 0, matches: [] };
    if (key[0] !== query[0]) return null;

    const matches: [number, number][] = [];
    let score = 0;
    let q = 0;
    let lastMatch = -2;
    for (let i = 0; i < key.length && q < query.length; i++) {
        if (key[i] !== query[q]) continue;

        if (lastMatch === i - 1 && matches.length > 0) {
            matches[matches.length - 1][1] = i + 1;
            score += 2;
        } else {
            matches.push([i, i + 1]);
            score -= i - lastMatch - 1 > 0 && lastMatch >= 0 ? 1 : 0;
        }
        lastMatch = i;
        q++;
    }

    if (q < query.length) return null;
    // Prefer shorter words
    score -= (key.length - query.length) * 0.01;
    return { score, matches };
}

/**
 * A set of words which can quickly be searched by prefix. For every combination of normalization options a sorted view
 * is built lazily and kept up to date incrementally afterwards.
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
            const key = normalize(word, view.opts);
            const index = lowerBound(view.keys, key);
            view.keys.splice(index, 0, key);
            view.words.splice(index, 0, word);
        }
        return true;
    }

    /** Replaces all words. Faster than adding them one by one. */
    setAll(words: Iterable<string>) {
        this.words.clear();
        for (const w of words) if (w) this.words.add(w);
        this.views.clear();
    }

    delete(word: string): boolean {
        if (!this.words.delete(word)) return false;
        for (const view of this.views.values()) {
            const i = view.words.indexOf(word);
            if (i !== -1) {
                view.keys.splice(i, 1);
                view.words.splice(i, 1);
            }
        }
        return true;
    }

    clear() {
        this.words.clear();
        this.views.clear();
    }

    private getView(opts: NormalizationOptions): View {
        const mode = (opts.ignoreCase ? "i" : "") + (opts.ignoreDiacritics ? "d" : "");
        let view = this.views.get(mode);
        if (!view) {
            const entries = Array.from(this.words, (w) => [normalize(w, opts), w] as const);
            entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
            view = {
                opts: { ignoreCase: opts.ignoreCase, ignoreDiacritics: opts.ignoreDiacritics },
                keys: entries.map((e) => e[0]),
                words: entries.map((e) => e[1]),
            };
            this.views.set(mode, view);
        }
        return view;
    }

    /**
     * Returns all words starting with `query` (after normalization), followed by fuzzy matches if enabled. An empty
     * query returns all words.
     */
    search(query: string, opts: SearchOptions): WordMatch[] {
        const view = this.getView(opts);
        const q = normalize(query, opts);
        const result: WordMatch[] = [];
        const prefixRange: [number, number][] = q.length > 0 ? [[0, query.length]] : [];

        const start = lowerBound(view.keys, q);
        let end = start;
        for (; end < view.keys.length && view.keys[end].startsWith(q); end++) {
            result.push({ word: view.words[end], isPrefixMatch: true, score: 0, matches: prefixRange });
        }

        if (!opts.fuzzy || q.length < 2) return result;

        // Fuzzy matches have to start with the same character, so only the range of keys starting with it is scanned.
        const firstChar = q[0];
        const fuzzyStart = lowerBound(view.keys, firstChar);
        const fuzzyLimit = opts.fuzzyLimit ?? 200;
        const fuzzy: WordMatch[] = [];
        for (let i = fuzzyStart; i < view.keys.length; i++) {
            const key = view.keys[i];
            if (key[0] !== firstChar) break;
            if (i >= start && i < end) continue; // already a prefix match

            const m = fuzzyMatch(q, key);
            if (!m) continue;
            // Match positions refer to the normalized key. They are only reliable for highlighting if normalization
            // did not change the length.
            const word = view.words[i];
            fuzzy.push({
                word,
                isPrefixMatch: false,
                score: m.score,
                matches: key.length === word.length ? m.matches : [],
            });
        }

        fuzzy.sort((a, b) => b.score - a.score);
        if (fuzzy.length > fuzzyLimit) fuzzy.length = fuzzyLimit;
        return result.concat(fuzzy);
    }
}
