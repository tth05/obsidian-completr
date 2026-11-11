import type { EditorView } from "@codemirror/view";
import type { Editor, EditorPosition } from "obsidian";
import { type CursorContext, getCursorContext, getLatexContext, type MathType } from "./editor_context.ts";
import type { SuggestionBlacklist } from "./provider/blacklist.ts";
import { armPeriod } from "./period.ts";
import type { Suggestion, SuggestionContext, SuggestionProvider } from "./provider/provider.ts";
import type { CompletrSettings } from "./settings.ts";
import { insertSnippet } from "./snippets.ts";
import { isWordChar, matchWordBackwards, type WordBeforeCursor } from "./text.ts";
import type { SuggestionUsage } from "./usage.ts";

/**
 * The suggestion pipeline shared by the popup and the inline suggestions: which word is completed, which suggestions
 * there are for it, and how one is inserted.
 */

export const MAX_SUGGESTIONS = 100;

/** What the pipeline needs from the plugin. */
export interface SuggestionSources {
    readonly settings: CompletrSettings;
    /** In priority order. */
    readonly providers: readonly SuggestionProvider[];
    readonly blacklist: Pick<SuggestionBlacklist, "has">;
    readonly usage: Pick<SuggestionUsage, "get" | "record">;
}

export interface SuggestionList {
    suggestions: Suggestion[];
    /**
     * Where the replacement starts if not at the start of the query: set when a provider that blocks all others
     * replaces from somewhere else (e.g. a callout type, which starts at "[!").
     */
    start: EditorPosition | null;
}

/** The word in front of the cursor, which the suggestions complete. */
export function getWordBeforeCursor(line: string, ch: number, settings: CompletrSettings): WordBeforeCursor {
    return matchWordBackwards(line, ch, (c) => isWordChar(c, settings.characterRegex), settings.maxLookBackDistance);
}

/**
 * The context the providers work with.
 * @param manual the popup was opened with the "open suggestion popup" command, minimum lengths don't apply
 */
export function createSuggestionContext(
    editor: Editor,
    end: EditorPosition,
    word: WordBeforeCursor,
    manual: boolean,
): SuggestionContext {
    const state = editor.cm.state;
    const offset = editor.posToOffset(end);
    // Looking at the syntax tree is the expensive part, and several providers ask the same questions
    let cursor: CursorContext | undefined;
    const getCursor = () => (cursor ??= getCursorContext(state, offset));
    const mathTypes = new Map<boolean, MathType | null>();

    return {
        editor,
        state,
        end,
        query: word.query,
        separatorChar: word.separatorChar,
        line: editor.getLine(end.line),
        manual,
        get inCode() {
            return getCursor().inCode;
        },
        mathType(triggerInCode) {
            let type = mathTypes.get(triggerInCode);
            if (type === undefined) {
                type = getLatexContext(state, offset, triggerInCode, getCursor());
                mathTypes.set(triggerInCode, type);
            }
            return type;
        },
    };
}

/** Asks the providers, removes duplicates and blacklisted suggestions, ranks and limits the result. */
export function computeSuggestions(sources: SuggestionSources, context: SuggestionContext): SuggestionList {
    const { settings, blacklist, usage } = sources;
    let suggestions: Suggestion[] = [];
    let start: EditorPosition | null = null;
    for (const provider of sources.providers) {
        const result = provider.getSuggestions(context, settings);
        if (result.length === 0) continue;
        for (const s of result) s.provider = provider;

        if (provider.blocksAllOtherProviders) {
            suggestions = result;
            start = result.find((s) => s.overrideStart)?.overrideStart ?? null;
            break;
        }
        suggestions.push(...result);
    }

    // The one place where the blacklist is applied
    const seen = new Set<string>();
    suggestions = suggestions.filter((s) => {
        if (seen.has(s.displayName) || blacklist.has(s.displayName)) return false;
        seen.add(s.displayName);
        return true;
    });

    // Stable sort: the providers' order is kept, except that fuzzy matches of one provider never come before the
    // better matches of another, and (optionally) that frequently used suggestions come first within those groups.
    const byUsage = settings.rankByUsage;
    suggestions.sort(
        (a, b) =>
            Number(!!a.isFuzzy) - Number(!!b.isFuzzy) ||
            (byUsage ? usage.get(b.displayName) - usage.get(a.displayName) : 0),
    );

    return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), start };
}

/** Replaces `from`-`to` with the suggestion (a snippet gets its placeholders) and records its usage. */
export function insertSuggestion(
    sources: SuggestionSources,
    view: EditorView,
    value: Suggestion,
    from: number,
    to: number,
) {
    let replacement = value.replacement;
    const appendSpace = !!value.appendSpace && !/^\s/.test(view.state.doc.sliceString(to, to + 1));
    if (appendSpace) replacement += " ";

    if (value.snippet) {
        insertSnippet(view, from, to, replacement, value.snippet);
    } else {
        const end = from + replacement.length;
        view.dispatch({
            changes: { from, to, insert: replacement },
            selection: { anchor: end },
            // Pressing Space next turns the appended space into ". " (see period.ts)
            effects: appendSpace && sources.settings.insertPeriodAfterSpace ? armPeriod.of(end) : [],
            scrollIntoView: true,
        });
    }

    if (sources.settings.rankByUsage) sources.usage.record(value.displayName);
}
