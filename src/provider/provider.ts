import {EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";

export interface SuggestionContext extends EditorSuggestContext {
    separatorChar: string;
}

export interface SuggestionProvider {
    getSuggestions(context: SuggestionContext, settings: CompletrSettings): string[]
}
