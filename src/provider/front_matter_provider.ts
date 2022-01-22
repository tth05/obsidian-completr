import {Suggestion, SuggestionContext, SuggestionProvider} from "./provider";
import {CompletrSettings} from "../settings";
import {CachedMetadata, Editor, EditorPosition, MetadataCache, TFile} from "obsidian";
import {matchWordBackwards} from "../editor_helpers";

function findTagCompletionType(currentLineIndex: number, currentLine: string, editor: Editor): "inline" | "multiline" | "none" {
    //Easy case
    if (currentLine.startsWith("tags: "))
        return "inline";
    //Check for YAML multi-line list
    if (!currentLine.startsWith("- "))
        return "none";

    let foundListStart = false;
    for (let i = currentLineIndex - 1; i >= 1; i--) {
        let line = editor.getLine(i).trim();
        //Found YAML key
        if (line.endsWith(":")) {
            //Check if we found the correct key
            foundListStart = line.startsWith("tags:");
            break;
        }
    }

    return foundListStart ? "multiline" : "none";
}

class FrontMatterSuggestionProvider implements SuggestionProvider {
    blocksAllOtherProviders: boolean = true;

    //This is a map to properly handle tag removals
    private globalTags: Map<string, Set<string>> = new Map<string, Set<string>>();

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.frontMatterProviderEnabled)
            return [];

        const firstLine = context.editor.getLine(0);
        const isInFrontMatter = FrontMatterSuggestionProvider.isInFrontMatter(context.editor, context.start);

        if (!isInFrontMatter && context.start.line === 0 && (firstLine === "" || "front-matter".startsWith(firstLine))) {
            return [
                {
                    displayName: "front-matter",
                    replacement: "---\n~\n---",
                    overrideStart: {line: 0, ch: 0}
                }
            ]
        } else if (!isInFrontMatter) {
            return [];
        }

        const lowerCaseQuery = context.query.toLowerCase();

        //Match snippets
        if (context.start.ch === 0) {
            return SNIPPETS.filter((snippet) => {
                if (typeof snippet === "string")
                    throw new Error("Unreachable");

                const key = snippet.displayName.substring(0, snippet.displayName.indexOf(":"));
                return key.startsWith(lowerCaseQuery);
            });
        }

        //YAML key specific completions
        const currentLine = context.editor.getLine(context.start.line);
        if (currentLine.startsWith("publish:")) { //Publish key
            const possibilities = ["true", "false"];
            const partialMatches = possibilities.filter(val => val.startsWith(lowerCaseQuery) && val !== lowerCaseQuery);
            if (partialMatches.length > 0)
                return partialMatches;
            else if (lowerCaseQuery === "true" || lowerCaseQuery === "false")
                return lowerCaseQuery === "true" ? possibilities.reverse() : possibilities;
            return [];
        } else { //Tag key
            let completionType = findTagCompletionType(context.start.line, currentLine, context.editor);
            if (completionType === "none")
                return [];

            //We need a custom query to force include `/`, `-`, `_` for tags.
            const {query} = matchWordBackwards(
                context.editor,
                context.end,
                (char) => new RegExp("[" + settings.characterRegex + "/\\-_]").test(char),
                settings.maxLookBackDistance
            );

            return this.getUniqueGlobalTags().filter(tag => tag.startsWith(query)).map(tag => ({
                displayName: tag,
                replacement: tag + (settings.frontMatterTagAppendSuffix ? (completionType === "inline" ? ", " : "\n- ") : ""),
                overrideStart: {...context.end, ch: context.end.ch - query.length}
            })).sort((a, b) => a.displayName.length - b.displayName.length);
        }

        return [];
    }

    loadGlobalTags(cache: MetadataCache, files: TFile[]) {
        for (let file of files) {
            this.addTagsFromFile(file, cache.getFileCache(file));
        }
    }

    readonly onCacheChange = (file: TFile, data: string, cache: CachedMetadata) => {
        this.addTagsFromFile(file, cache);
    }

    private addTagsFromFile(file: TFile, cache: CachedMetadata) {
        if (!cache || !cache.frontmatter || !cache.frontmatter.tags) {
            return;
        }

        const tags = new Set<string>();
        this.globalTags.set(file.path, tags);

        for (let tag of cache.frontmatter.tags) {
            if (!tag)
                continue;

            tags.add(tag);
        }
    }

    private getUniqueGlobalTags(): string[] {
        const allTags = new Set<string>();
        for (let set of this.globalTags.values()) {
            for (let tag of set) {
                allTags.add(tag);
            }
        }
        return [...allTags];
    }

    private static isInFrontMatter(editor: Editor, pos: EditorPosition): boolean {
        if (editor.getLine(0) !== "---" || editor.getLine(1) === "---" || pos.line === 0)
            return false;

        for (let i = 2; i < Math.max(30, editor.lastLine()); i++) {
            if (editor.getLine(i) === "---")
                return pos.line < i;
        }

        return false;
    }
}

export const FrontMatter = new FrontMatterSuggestionProvider();

const SNIPPETS: Suggestion[] = [
    {
        displayName: "tags: [#]",
        replacement: "tags: [~]"
    },
    {
        displayName: "tags: \\...",
        replacement: "tags:\n- ~"
    },
    {
        displayName: "aliases: [#]",
        replacement: "aliases: [~]"
    },
    {
        displayName: "publish: #",
        replacement: "publish: ~"
    },
    {
        displayName: "cssclass: #",
        replacement: "cssclass: ~"
    },
]
