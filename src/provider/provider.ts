import {EditorPosition, EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";
import {maybeLowerCase} from "../editor_helpers";

export class Suggestion {
    displayName: string;
    replacement: string;
    overrideStart?: EditorPosition;

    constructor(displayName: string, replacement: string, overrideStart?: EditorPosition) {
        this.displayName = displayName;
        this.replacement = replacement;
        this.overrideStart = overrideStart;
    }

    static fromString(suggestion: string, overrideStart?: EditorPosition): Suggestion {
        return new Suggestion(suggestion, suggestion, overrideStart);
    }

    getDisplayNameLowerCase(lowerCase: boolean): string {
        return maybeLowerCase(this.displayName, lowerCase);
    }
}

export interface SuggestionContext extends EditorSuggestContext {
    separatorChar: string;
}

export interface SuggestionProvider {
    blocksAllOtherProviders?: boolean,

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[],
}
