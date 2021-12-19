import {CompletrSettings, WordInsertionMode} from "../settings";
import {SuggestionContext, SuggestionProvider} from "./provider";

export abstract class DictionaryProvider implements SuggestionProvider {

    abstract readonly wordMap: Map<string, Iterable<string>>;

    abstract isEnabled(settings: CompletrSettings): boolean;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): string[] {
        if (!this.isEnabled(settings))
            return [];

        const ignoreCase = settings.wordInsertionMode != WordInsertionMode.MATCH_CASE_REPLACE;
        const query = ignoreCase ? context.query.toLowerCase() : context.query;
        const firstChar = query.charAt(0);

        //This is an array of arrays to avoid unnecessarily creating a new huge array containing all elements of both arrays.
        const list = ignoreCase ?
            [(this.wordMap.get(firstChar) ?? []), (this.wordMap.get(firstChar.toUpperCase()) ?? [])] //Get both lists if we're ignoring case
            :
            [this.wordMap.get(firstChar)];

        if (!list || list.length < 1)
            return [];

        //TODO: Rank those who match case higher
        let result: string[] = [];
        for (let el of list) {
            result = [...result, ...filterIntoArray(el, s => {
                const match = ignoreCase ? s.toLowerCase() : s;
                return match.startsWith(query);
            })];
        }

        result = result.sort((a, b) => a.length - b.length);

        //In append mode we combine the query with the suggestions
        if (settings.wordInsertionMode === WordInsertionMode.IGNORE_CASE_APPEND) {
            result = result.map(s => query + s.substring(query.length, s.length));
        }

        return result;
    }
}

function filterIntoArray<T>(iterable: Iterable<T>, predicate: (val: T) => boolean): T[] {
    const result: T[] = [];
    for (let val of iterable) {
        if (!predicate(val))
            continue;
        result.push(val);
    }

    return result;
}
