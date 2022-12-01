import {EditorPosition, EditorSuggestContext} from "obsidian";
import {CompletrSettings} from "../settings";
import {maybeLowerCase} from "../editor_helpers";

export class Suggestion {
    displayName: string;
    replacement: string;
    overrideStart?: EditorPosition;
    overrideEnd?: EditorPosition;

    constructor(displayName: string, replacement: string, overrideStart?: EditorPosition, overrideEnd?: EditorPosition) {
        this.displayName = displayName;
        this.replacement = replacement;
        this.overrideStart = overrideStart;
        this.overrideEnd = overrideEnd;
    }

    static fromString(suggestion: string, overrideStart?: EditorPosition): Suggestion {
        return new Suggestion(suggestion, suggestion, overrideStart);
    }

    getDisplayNameLowerCase(lowerCase: boolean): string {
        return maybeLowerCase(this.displayName, lowerCase);
    }

    derive(options: Partial<typeof this>) {
        const derived = new Suggestion(
            options.displayName ?? this.displayName,
            options.replacement ?? this.replacement,
            options.overrideStart ?? this.overrideStart,
            options.overrideEnd ?? this.overrideEnd,
        );

        return derived;
    }
}

export interface SuggestionContext extends EditorSuggestContext {
    separatorChar: string;
}

export interface SuggestionProvider {
    blocksAllOtherProviders?: boolean,

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[],
}
