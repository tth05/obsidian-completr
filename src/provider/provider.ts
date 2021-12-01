import {EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";

export default interface SuggestionProvider {
    getSuggestions(context: EditorSuggestContext, settings: CompletrSettings): string[]
}
