import {EditorSuggestContext} from "obsidian";

export default interface SuggestionProvider {
    getSuggestions(context: EditorSuggestContext): string[]
}
