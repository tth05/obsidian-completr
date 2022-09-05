import {CompletrSettings, WordInsertionMode} from "../settings";
import {SuggestionContext, SuggestionProvider} from "./provider";
import {maybeLowerCase} from "../editor_helpers";

export abstract class DictionaryProvider implements SuggestionProvider {

    abstract readonly wordMap: Map<string, Iterable<string>>;

    abstract isEnabled(settings: CompletrSettings): boolean;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): string[] {
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
        const result = new Set<string>();
        for (let el of list) {
            filterMapIntoSet(result, el, s => {
                    let match = maybeLowerCase(s, ignoreCase);
                    if (ignoreDiacritics)
                        match = removeDiacritics(match);
                    return match.startsWith(query);
                },
                settings.wordInsertionMode === WordInsertionMode.IGNORE_CASE_APPEND ?
                    //In append mode we combine the query with the suggestions
                    (s => context.query + s.substring(query.length, s.length)) :
                    (s => s)
            );
        }

        return [...result].sort((a, b) => a.length - b.length);
    }
}

const DIACRITICS_REGEX = /[\u0300-\u036f]/g

function removeDiacritics(str: string): string {
    return str.normalize("NFD").replace(DIACRITICS_REGEX, "");
}

function filterMapIntoSet<T>(set: Set<T>, iterable: Iterable<T>, predicate: (val: T) => boolean, map: (val: T) => T) {
    for (let val of iterable) {
        if (!predicate(val))
            continue;
        set.add(map(val));
    }
}
