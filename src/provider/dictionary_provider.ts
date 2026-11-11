import { type CompletrSettings, SortOrder, WordInsertionMode } from "../settings.ts";
import { applyTypedCasing } from "../text.ts";
import type { NormalizationOptions, WordIndex, WordMatch } from "../word_index.ts";
import type { Suggestion, SuggestionContext, SuggestionProvider } from "./provider.ts";

/** At most this many words are turned into suggestions, the popup can't show more than 100 anyway. */
const MAX_RESULTS = 200;

const collators = new Map<string, Intl.Collator>();

function getCollator(locale: string): Intl.Collator {
    let collator = collators.get(locale);
    if (!collator) {
        try {
            collator = new Intl.Collator(locale || undefined, { sensitivity: "base", numeric: true });
        } catch {
            collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
        }
        collators.set(locale, collator);
    }
    return collator;
}

export function sortWords(matches: WordMatch[], order: SortOrder, locale: string): WordMatch[] {
    let compare: (a: WordMatch, b: WordMatch) => number;
    switch (order) {
        case SortOrder.LONGEST_FIRST:
            compare = (a, b) => b.word.length - a.word.length;
            break;
        case SortOrder.ALPHABETICAL: {
            const collator = getCollator(locale);
            compare = (a, b) => collator.compare(a.word, b.word);
            break;
        }
        default:
            compare = (a, b) => a.word.length - b.word.length;
    }
    return matches.sort(compare);
}

export function getNormalization(settings: CompletrSettings): NormalizationOptions {
    return {
        ignoreCase: settings.wordInsertionMode !== WordInsertionMode.MATCH_CASE_REPLACE,
        ignoreDiacritics: settings.ignoreDiacriticsWhenFiltering,
    };
}

/** Base class for the providers that suggest plain words (file scanner, word lists). */
export abstract class DictionaryProvider implements SuggestionProvider {
    abstract readonly id: string;
    abstract readonly icon: string;

    protected abstract isEnabled(settings: CompletrSettings): boolean;

    /** The words to search in. */
    protected abstract getIndex(settings: CompletrSettings): WordIndex;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!this.isEnabled(settings)) return [];
        if (settings.disableWordsInCode && context.inCode) return [];
        // In math, a word right after a backslash is the name of a command, inserting a plain word would make it one.
        if (context.separatorChar === "\\" && context.mathType(settings.latexTriggerInCodeBlocks) !== null) return [];

        const { query } = context;
        // Manually opening the popup ignores the minimum length, an empty query then lists all words.
        if (!context.manual && (query.length === 0 || query.length < settings.minWordTriggerLength)) return [];

        const appendMode = settings.wordInsertionMode === WordInsertionMode.IGNORE_CASE_APPEND;
        const matches = this.getIndex(settings).search(query, {
            ...getNormalization(settings),
            fuzzy: settings.fuzzyMatching,
            fuzzyLimit: MAX_RESULTS,
        });

        const prefix: WordMatch[] = [];
        const fuzzy: WordMatch[] = [];
        for (const m of matches) {
            // Words shorter than the minimum length may still be known, e.g. after the setting was changed.
            // The exact word that was typed is useless as a suggestion.
            if (m.word.length < settings.minWordLength || m.word === query) continue;
            (m.isPrefixMatch ? prefix : fuzzy).push(m);
        }

        const sorted = sortWords(prefix, settings.sortOrder, settings.sortLocale);
        sorted.length = Math.min(sorted.length, MAX_RESULTS);
        const result: Suggestion[] = [];
        for (const m of sorted.concat(fuzzy)) {
            const text = appendMode && m.isPrefixMatch ? applyTypedCasing(query, m.word) : m.word;
            // Append mode keeps the typed casing, so a known word may turn into exactly what was typed
            if (text === query) continue;
            result.push({
                displayName: text,
                replacement: text,
                matches: m.matches,
                isFuzzy: !m.isPrefixMatch,
                appendSpace: settings.insertSpaceAfterWord,
            });
        }
        return result;
    }
}
