import {getSuggestionDisplayName, Suggestion, SuggestionContext, SuggestionProvider} from "./provider";
import {CompletrSettings} from "../settings";
import {CachedMetadata, Editor, getAllTags, MetadataCache, TFile} from "obsidian";
import {isInFrontMatterBlock, matchWordBackwards} from "../editor_helpers";

const BASE_SUGGESTION: Suggestion = {
    displayName: "front-matter",
    replacement: "---\n~\n---",
    overrideStart: {line: 0, ch: 0}
};

const PUBLISH_SUGGESTION: Suggestion = {
    displayName: "publish: #",
    replacement: "publish: ~"
};

function findTagCompletionType(keyInfo: YAMLKeyInfo, currentLineIndex: number, currentLine: string, editor: Editor): "inline" | "multiline" | "none" {
    const {key, isList} = keyInfo;

    //Easy case
    if (currentLine.startsWith(key + ": "))
        return "inline";
    //Check for YAML multi-line list
    if (!currentLine.startsWith("- ") || !isList)
        return "none";

    let foundListStart = false;
    for (let i = currentLineIndex - 1; i >= 1; i--) {
        let line = editor.getLine(i).trim();
        //Found YAML key
        if (line.endsWith(":")) {
            //Check if we found the correct key
            foundListStart = line.startsWith(key + ":");
            break;
        }
    }

    return foundListStart ? "multiline" : "none";
}

interface YAMLKeyInfo {
    key: string,
    isList: boolean,
    completions: Set<string>
}

class YAMLKeyCache {
    private readonly listKeys: string[] = [];
    private readonly keyMap: Map<string, Set<string>> = new Map<string, Set<string>>();

    addEntry(key: string, value: string) {
        let values = this.keyMap.get(key);
        if (!values) {
            values = new Set<string>();
            this.keyMap.set(key, values);
        }

        values.add(value);
    }

    addEntries(key: string, values: string[]) {
        let set = this.keyMap.get(key);
        if (!set) {
            set = new Set<string>();
            this.keyMap.set(key, set);
        }

        for (let value of values) {
            if (!value)
                continue;

            set.add(value);
        }

        this.listKeys.push(key);
    }

    isListKey(key: string): boolean {
        return this.listKeys.contains(key);
    }

    getCompletions(): YAMLKeyInfo[] {
        return [...this.keyMap.entries()].map(([e, v]) => ({key: e, isList: this.isListKey(e), completions: v}));
    }
}

class FrontMatterSuggestionProvider implements SuggestionProvider {
    blocksAllOtherProviders: boolean = true;

    private fileSuggestionCache: Map<string, YAMLKeyCache> = new Map<string, YAMLKeyCache>();

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.frontMatterProviderEnabled)
            return [];

        const firstLine = context.editor.getLine(0);
        const isInFrontMatter = isInFrontMatterBlock(context.editor, context.start);

        if (!isInFrontMatter && context.start.line === 0 && (firstLine === "" || "front-matter".startsWith(firstLine))) {
            return [BASE_SUGGESTION];
        } else if (!isInFrontMatter) {
            return [];
        }

        const lowerCaseQuery = context.query.toLowerCase();

        //Match snippets
        if (context.start.ch === 0) {
            const suggestions: Suggestion[] = this.getPossibleCompletions().flatMap(i => {
                if (!i.isList) {
                    return [{
                        displayName: i.key + ": #",
                        replacement: i.key + ": ~"
                    }];
                }

                return [
                    {
                        displayName: i.key + ": [#]",
                        replacement: i.key + ": [~]"
                    },
                    {
                        displayName: i.key + ": \\...",
                        replacement: i.key + ":\n- ~"
                    }
                ];
            })
            suggestions.push(PUBLISH_SUGGESTION);
            return suggestions.filter((snippet) => {
                const displayName = getSuggestionDisplayName(snippet);
                const key = displayName.substring(0, displayName.indexOf(":"));
                return key.startsWith(lowerCaseQuery);
            });
        }

        //YAML key specific completions
        const currentLine = context.editor.getLine(context.start.line);
        if (currentLine.startsWith("publish:")) { //Publish key
            return FrontMatterSuggestionProvider.getPublishSuggestions(lowerCaseQuery);
        }

        //Custom keys
        const {key, type} = this.getPossibleCompletions()
            .map(possibleKey => ({
                key: possibleKey,
                type: findTagCompletionType(possibleKey, context.start.line, currentLine, context.editor)
            }))
            .filter(({type}) => type !== "none")
            .shift() ?? {};
        if (!key)
            return [];

        //We need a custom query to force include `/`, `-`, `_` for tags.
        const {query} = matchWordBackwards(
            context.editor,
            context.end,
            (char) => new RegExp("[" + settings.characterRegex + "/\\-_]", "u").test(char),
            settings.maxLookBackDistance
        );

        return [...key.completions].filter(tag => tag.startsWith(query)).map(tag => ({
            displayName: tag,
            replacement: tag + (settings.frontMatterTagAppendSuffix && key.isList ? (type === "inline" ? ", " : "\n- ") : ""),
            overrideStart: {...context.end, ch: context.end.ch - query.length}
        })).sort((a, b) => a.displayName.length - b.displayName.length);
    }

    loadYAMLKeyCompletions(cache: MetadataCache, files: TFile[]) {
        for (let file of files) {
            this.addKeyCompletionsFromFile(file, cache.getFileCache(file));
        }
    }

    readonly onCacheChange = (file: TFile, data: string, cache: CachedMetadata) => {
        this.addKeyCompletionsFromFile(file, cache);
    }

    private addKeyCompletionsFromFile(file: TFile, cache: CachedMetadata) {
        if (!file || !cache || !cache.frontmatter) {
            return;
        }

        const keyCache = new YAMLKeyCache();
        this.fileSuggestionCache.set(file.path, keyCache);

        for (let key of Object.keys(cache.frontmatter)) {
            if (key === "position" || key === "publish" || key === "tags")
                continue;

            let prop = cache.frontmatter[key];
            if (!prop)
                continue;

            if (Array.isArray(prop)) {
                keyCache.addEntries(key, prop);
            } else {
                keyCache.addEntry(key, prop);
            }
        }

        //Handle tags using the specialized obsidian parser
        const tags = getAllTags(cache);
        if (tags && tags.length > 0)
            keyCache.addEntries("tags", tags.map(t => t.substring(1)));
    }

    private getPossibleCompletions(): YAMLKeyInfo[] {
        const listKeys = new Set<string>();
        const allKeys = new Map<string, Set<string>>();
        for (let cache of this.fileSuggestionCache.values()) {
            for (let keyInfo of cache.getCompletions()) {
                let completions = allKeys.get(keyInfo.key);
                if (!completions) {
                    completions = new Set<string>();
                    allKeys.set(keyInfo.key, completions);
                }

                keyInfo.completions.forEach(c => completions.add(c));
                if (keyInfo.isList)
                    listKeys.add(keyInfo.key);
            }
        }

        return [...allKeys.entries()].map(([k, completions]) => ({
            key: k,
            isList: listKeys.has(k),
            completions: completions
        }));
    }

    private static getPublishSuggestions(lowerCaseQuery: string) {
        const possibilities = ["true", "false"];
        const partialMatches = possibilities.filter(val => val.startsWith(lowerCaseQuery) && val !== lowerCaseQuery);
        if (partialMatches.length > 0)
            return partialMatches;
        else if (lowerCaseQuery === "true" || lowerCaseQuery === "false")
            return lowerCaseQuery === "true" ? possibilities.reverse() : possibilities;
        return [];
    }
}

export const FrontMatter = new FrontMatterSuggestionProvider();
