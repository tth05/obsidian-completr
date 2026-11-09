import type { EditorState } from "@codemirror/state";
import type { Editor, EditorPosition, TFile } from "obsidian";
import type { CompletrSettings } from "../settings.ts";
import type { SnippetSyntax } from "../snippets.ts";

export interface Suggestion {
    /** The text shown in the popup. Also used for de-duplication, the blacklist and usage ranking. */
    displayName: string;
    /** The text that is inserted. If {@link isSnippet} is set, "#" marks placeholders and "~" the final cursor position. */
    replacement: string;
    /** Replace from here instead of from the start of the query. */
    overrideStart?: EditorPosition;
    /** Replace until here instead of until the cursor. */
    overrideEnd?: EditorPosition;
    icon?: string;
    /** Any CSS color, used for the icon. */
    color?: string;
    isSnippet?: boolean;
    /** Placeholder syntax of a snippet, "latex" if not set. */
    snippetSyntax?: SnippetSyntax;
    /** Insert a space after the replacement, unless there already is whitespace after the cursor. */
    appendSpace?: boolean;
    /** [start, end) ranges of {@link displayName} to highlight as matched. */
    matches?: [number, number][];
    /** Fuzzy matches are always ranked after exact/prefix matches. */
    isFuzzy?: boolean;
    /** Set by the popup: the id of the provider this suggestion came from. */
    providerId?: string;
}

export function suggestion(displayName: string, replacement = displayName, extra?: Partial<Suggestion>): Suggestion {
    return { displayName, replacement, ...extra };
}

export interface SuggestionContext {
    editor: Editor;
    /** The CodeMirror state of the editor. */
    state: EditorState;
    file: TFile | null;
    /** Start of the word in front of the cursor. */
    start: EditorPosition;
    /** The cursor. */
    end: EditorPosition;
    /** The word in front of the cursor, see {@link CompletrSettings.characterRegex}. */
    query: string;
    /** The character in front of {@link query}, null if there is none (start of line). */
    separatorChar: string | null;
    /** The text of the cursor's line. */
    line: string;
    /** The popup was opened by the "open suggestion popup" command, min length settings should be ignored. */
    manual: boolean;
    /** Whether the cursor is inside a code block or inline code. */
    readonly inCode: boolean;
}

export interface SuggestionProvider {
    readonly id: string;
    /** Lucide icon id, shown depending on {@link CompletrSettings.iconMode}. */
    readonly icon: string;
    /** If this provider returns suggestions, all providers after it are skipped. */
    readonly blocksAllOtherProviders?: boolean;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[];
}
