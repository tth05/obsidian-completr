import { CompletrSettings, WordInsertionMode } from "../settings";
import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { maybeLowerCase } from "../editor_helpers";

export abstract class DictionaryProvider implements SuggestionProvider {

    abstract readonly wordMap: Map<string, Iterable<string>>;

    abstract isEnabled(settings: CompletrSettings): boolean;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!this.isEnabled(settings) || !context.query || context.query.length < settings.minWordTriggerLength)
            return [];

        const ignoreCase = settings.wordInsertionMode != WordInsertionMode.MATCH_CASE_REPLACE;

        let query = maybeLowerCase(context.query, ignoreCase);
        const ignoreDiacritics = settings.ignoreDiacriticsWhenFiltering;
        if (ignoreDiacritics)
            query = removeDiacritics(query);

        const firstChar = query.charAt(0);

        //This is an array of arrays to avoid unnecessarily creating a new huge array containing all elements of both arrays.
        const list = ignoreCase ?
            [(this.wordMap.get(firstChar) ?? []), (this.wordMap.get(firstChar.toUpperCase()) ?? [])] //Get both lists if we're ignoring case
            :
            [this.wordMap.get(firstChar) ?? []];

        if (ignoreDiacritics) {
            // This additionally adds all words that start with a diacritic, which the two maps above might not cover.
            for (let [key, value] of this.wordMap.entries()) {
                let keyFirstChar = maybeLowerCase(key.charAt(0), ignoreCase);

                if (removeDiacritics(keyFirstChar) === firstChar)
                    list.push(value);
            }
        }

        if (!list || list.length < 1)
            return [];

        //TODO: Rank those who match case higher
        const result: Suggestion[] = [];
        for (let el of list) {
            filterMapIntoArray(result, el, s => {
                    let match = maybeLowerCase(s, ignoreCase);
                    if (ignoreDiacritics)
                        match = removeDiacritics(match);
                    return match.startsWith(query);
                },
                settings.wordInsertionMode === WordInsertionMode.IGNORE_CASE_APPEND ?
                    //In append mode we combine the query with the suggestions
                    (s => Suggestion.fromString(context.query + s.substring(query.length, s.length))) :
                    (s => Suggestion.fromString(s))
            );
        }

        return result.sort((a, b) => a.displayName.length - b.displayName.length);
    }
}

const DIACRITICS_REGEX = /[\u0300-\u036f]/g

function removeDiacritics(str: string): string {
    return str.normalize("NFD").replace(DIACRITICS_REGEX, "");
}

function filterMapIntoArray<T, U>(array: Array<T>, iterable: Iterable<U>, predicate: (val: U) => boolean, map: (val: U) => T) {
    for (let val of iterable) {
        if (!predicate(val))
            continue;
        array.push(map(val));
    }
}
