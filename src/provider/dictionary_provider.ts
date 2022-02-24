import {CompletrSettings, WordInsertionMode} from "../settings";
import {SuggestionContext, SuggestionProvider} from "./provider";

export abstract class DictionaryProvider implements SuggestionProvider {

    abstract readonly wordMap: Map<string, Iterable<string>>;

    abstract isEnabled(settings: CompletrSettings): boolean;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): string[] {
        if (!this.isEnabled(settings) || !context.query || context.query.length < settings.minWordTriggerLength)
            return [];

        const ignoreCase = settings.wordInsertionMode != WordInsertionMode.MATCH_CASE_REPLACE;
        const query = ignoreCase ? context.query.toLowerCase() : context.query;
        const firstChar = query.charAt(0);

        //This is an array of arrays to avoid unnecessarily creating a new huge array containing all elements of both arrays.
        const list = ignoreCase ?
            [(this.wordMap.get(firstChar) ?? []), (this.wordMap.get(firstChar.toUpperCase()) ?? [])] //Get both lists if we're ignoring case
            :
            [this.wordMap.get(firstChar) ?? []];

        if (!list || list.length < 1)
            return [];

        //TODO: Rank those who match case higher
        const result = new Set<string>();
        for (let el of list) {
            filterMapIntoSet(result, el, s => {
                    const match = ignoreCase ? s.toLowerCase() : s;
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

function filterMapIntoSet<T>(set: Set<T>, iterable: Iterable<T>, predicate: (val: T) => boolean, map: (val: T) => T) {
    for (let val of iterable) {
        if (!predicate(val))
            continue;
        set.add(map(val));
    }
}
