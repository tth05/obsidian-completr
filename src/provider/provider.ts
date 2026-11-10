import type { EditorState } from "@codemirror/state";
import type { Editor, EditorPosition } from "obsidian";
import type { MathType } from "../editor_context.ts";
import type { CompletrSettings } from "../settings.ts";
import type { SnippetSyntax } from "../snippets.ts";
import type { CustomEntry, CustomEntryFile } from "./custom_suggestions.ts";

export interface Suggestion {
    /** The text shown in the popup. Also used for de-duplication, the blacklist and usage ranking. */
    displayName: string;
    /** The text that is inserted. */
    replacement: string;
    /** Replace from here instead of from the start of the query. */
    overrideStart?: EditorPosition;
    /** Replace until here instead of until the cursor. */
    overrideEnd?: EditorPosition;
    icon?: string;
    /** Any CSS color, used for the icon. */
    color?: string;
    /** Set if {@link replacement} contains placeholders, in this syntax. */
    snippet?: SnippetSyntax;
    /** Insert a space after the replacement, unless there already is whitespace after the cursor. */
    appendSpace?: boolean;
    /** [start, end) ranges of {@link displayName} to highlight as matched. */
    matches?: [number, number][];
    /** Fuzzy matches are always ranked after exact/prefix matches. */
    isFuzzy?: boolean;
    /** Muted text shown next to the name, e.g. the start of a snippet's text. */
    detail?: string;
    /** TeX source that is rendered next to the name as a preview. */
    previewTex?: string;
    /** The user defined entry this suggestion was made from. Lets the popup offer to edit it. */
    customEntry?: CustomEntry;
    /** Set by the popup: the provider this suggestion came from. */
    provider?: SuggestionProvider;
}

export function suggestion(displayName: string, replacement = displayName, extra?: Partial<Suggestion>): Suggestion {
    return { displayName, replacement, ...extra };
}

export interface SuggestionContext {
    editor: Editor;
    /** The CodeMirror state of the editor. */
    state: EditorState;
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
    /** Whether the cursor is inside a code block or inline code. Computed on first use. */
    readonly inCode: boolean;
    /**
     * Whether the cursor is inside math, and of which kind. Computed on first use.
     * @param triggerInCode whether a dollar sign inside code counts as math (e.g. `$\fr`).
     */
    mathType(triggerInCode: boolean): MathType | null;
}

export interface SuggestionProvider {
    readonly id: string;
    /** Lucide icon id, shown depending on {@link CompletrSettings.iconMode}. */
    readonly icon: string;
    /** If this provider returns suggestions, all providers after it are skipped. */
    readonly blocksAllOtherProviders?: boolean;
    /** The user defined entries of this provider, see {@link Suggestion.customEntry}. */
    readonly customEntries?: CustomEntryFile;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[];
}
