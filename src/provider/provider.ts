import {EditorPosition, EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";

export type Suggestion = string | { displayName: string, replacement: string, overrideStart?: EditorPosition };

export function getSuggestionDisplayName(suggestion: Suggestion): string {
    return typeof (suggestion) === "string" ? suggestion : suggestion.displayName;
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
