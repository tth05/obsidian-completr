import {EditorPosition, EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";

export type Suggestion = string | { displayName: string, replacement: string, overrideStart?: EditorPosition };

export function getSuggestionDisplayName(suggestion: Suggestion, lowerCase: boolean = false): string {
    const res = typeof (suggestion) === "string" ? suggestion : suggestion.displayName;
    return lowerCase ? res.toLowerCase() : res;
}

export function getSuggestionReplacement(suggestion: Suggestion): string {
    return typeof (suggestion) === "string" ? suggestion : suggestion.replacement;
}

export interface SuggestionContext extends EditorSuggestContext {
    separatorChar: string;

}

export interface SuggestionProvider {
    blocksAllOtherProviders?: boolean,

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[],
}
