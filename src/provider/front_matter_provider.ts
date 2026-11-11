import { type CachedMetadata, getAllTags, type MetadataCache, type TFile } from "obsidian";
import type { CompletrSettings } from "../settings.ts";
import { findFrontMatterBounds, maybeLowerCase } from "../text.ts";
import { type Suggestion, type SuggestionContext, type SuggestionProvider, suggestion } from "./provider.ts";

interface KeyInfo {
    key: string;
    isList: boolean;
    values: Set<string>;
}

/** Keys that Obsidian itself understands. Always suggested, even if no note uses them yet. */
const BUILT_IN_LIST_KEYS = ["tags", "aliases", "cssclasses"];

const FRONT_MATTER_SNIPPET = suggestion("front-matter", "---\n~\n---", {
    overrideStart: { line: 0, ch: 0 },
    snippet: "latex",
});

/** Turns a front matter value into the strings that can be suggested. Objects are ignored. */
function valueToStrings(value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.flatMap((v) => valueToStrings(v) ?? []);
    if (typeof value === "string") return value ? [value] : [];
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
    return null;
}

interface ValuePosition {
    key: string;
    /** "inline" for `key: value` and `key: [a, b]`, "multiline" for `- value` list items below `key:`. */
    type: "inline" | "inline-list" | "multiline";
    /** Offset in the line where the value under the cursor starts. */
    start: number;
}

/** Finds out which key's value the cursor is in. `before` is the line's text in front of the cursor. */
export function findValuePosition(
    before: string,
    getLineAbove: (offset: number) => string | null,
): ValuePosition | null {
    const inline = /^([^\s:#-][^:]*):[ \t]+/.exec(before);
    if (inline) {
        const key = inline[1].trim();
        const rest = before.substring(inline[0].length);
        if (rest.startsWith("[")) {
            const lastSeparator = Math.max(rest.lastIndexOf("["), rest.lastIndexOf(","));
            let start = inline[0].length + lastSeparator + 1;
            while (before[start] === " ") start++;
            return { key, type: "inline-list", start };
        }
        return { key, type: "inline", start: inline[0].length };
    }

    const item = /^(\s*)-[ \t]+/.exec(before);
    if (!item) return null;
    // Find the key this list belongs to
    for (let i = 1; ; i++) {
        const line = getLineAbove(i);
        if (line === null) return null;
        const keyMatch = /^([^\s:#-][^:]*):\s*$/.exec(line);
        if (keyMatch) return { key: keyMatch[1].trim(), type: "multiline", start: item[0].length };
        // Only list items (or empty lines) may be between the key and the cursor
        if (line.trim() !== "" && !/^\s*-(\s|$)/.test(line)) return null;
    }
}

/** Suggests keys and values inside the YAML front matter, based on the front matter of all notes in the vault. */
export class FrontMatterProvider implements SuggestionProvider {
    readonly id = "front-matter";
    readonly icon = "braces";
    readonly blocksAllOtherProviders = true;

    private readonly fileKeys = new Map<string, Map<string, KeyInfo>>();
    private merged: Map<string, KeyInfo> | null = null;

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.frontMatterProviderEnabled) return [];

        const { editor } = context;
        const lineNumber = context.end.line;
        const bounds = findFrontMatterBounds((i) => editor.getLine(i), editor.lineCount());
        const ignoreCase = settings.frontMatterIgnoreCase;

        if (!bounds) {
            const firstLine = editor.getLine(0);
            if (
                lineNumber === 0 &&
                (context.manual || firstLine.length > 0) &&
                "front-matter".startsWith(maybeLowerCase(firstLine, ignoreCase))
            )
                return [{ ...FRONT_MATTER_SNIPPET, overrideEnd: { line: 0, ch: firstLine.length } }];
            return [];
        }
        if (lineNumber <= bounds.startLine || lineNumber >= bounds.endLine) return [];

        const before = context.line.substring(0, context.end.ch);
        const value = findValuePosition(before, (offset) =>
            lineNumber - offset > bounds.startLine ? editor.getLine(lineNumber - offset) : null,
        );
        if (value) return this.getValueSuggestions(context, settings, value, before);

        // Typing a key at the start of the line
        if (!/^[^\s:]*$/.test(before)) return [];
        const query = maybeLowerCase(before, ignoreCase);
        if (!context.manual && query.length === 0) return [];
        const start = { line: lineNumber, ch: 0 };
        const result: Suggestion[] = [];
        for (const info of this.getKeys().values()) {
            if (!maybeLowerCase(info.key, ignoreCase).startsWith(query)) continue;
            const s = (display: string, replacement: string) =>
                suggestion(display, replacement, { overrideStart: start, snippet: "latex" });
            if (info.isList)
                result.push(s(info.key + ": [#]", info.key + ": [~]"), s(info.key + ": \\...", info.key + ":\n- ~"));
            else result.push(s(info.key + ": #", info.key + ": ~"));
        }
        return result.sort((a, b) => a.displayName.length - b.displayName.length);
    }

    private getValueSuggestions(
        context: SuggestionContext,
        settings: CompletrSettings,
        pos: ValuePosition,
        before: string,
    ): Suggestion[] {
        const ignoreCase = settings.frontMatterIgnoreCase;
        const typed = before.substring(pos.start);
        const query = maybeLowerCase(typed, ignoreCase);
        if (!context.manual && query.length === 0) return [];

        const info =
            pos.key === "publish" ? { isList: false, values: new Set(["true", "false"]) } : this.getKeys().get(pos.key);
        if (!info) return [];

        let suffix = "";
        if (settings.frontMatterTagAppendSuffix && info.isList) {
            if (pos.type === "inline-list") suffix = ", ";
            else if (pos.type === "multiline") suffix = "\n" + (/^\s*/.exec(context.line)?.[0] ?? "") + "- ";
        }

        const prefix: string[] = [];
        const contains: string[] = [];
        for (const v of info.values) {
            if (v === typed) continue;
            const normalized = maybeLowerCase(v, ignoreCase);
            if (normalized.startsWith(query)) prefix.push(v);
            else if (query.length > 0 && normalized.includes(query)) contains.push(v);
        }
        prefix.sort((a, b) => a.length - b.length);
        contains.sort((a, b) => a.length - b.length);

        const start = { line: context.end.line, ch: pos.start };
        return [...prefix, ...contains].map((v) => suggestion(v, v + suffix, { overrideStart: start }));
    }

    /** All keys with their known values, merged across files. */
    private getKeys(): Map<string, KeyInfo> {
        if (this.merged) return this.merged;
        const merged = new Map<string, KeyInfo>();
        for (const key of BUILT_IN_LIST_KEYS) merged.set(key, { key, isList: true, values: new Set() });
        for (const keys of this.fileKeys.values()) {
            for (const info of keys.values()) {
                let target = merged.get(info.key);
                if (!target) merged.set(info.key, (target = { key: info.key, isList: false, values: new Set() }));
                target.isList ||= info.isList;
                for (const v of info.values) target.values.add(v);
            }
        }
        return (this.merged = merged);
    }

    loadAll(cache: MetadataCache, files: TFile[]) {
        for (const file of files) this.updateFile(file, cache.getFileCache(file));
    }

    updateFile(file: TFile, cache: CachedMetadata | null) {
        this.merged = null;
        if (!cache?.frontmatter) {
            this.fileKeys.delete(file.path);
            return;
        }

        const keys = new Map<string, KeyInfo>();
        for (const [key, value] of Object.entries(cache.frontmatter)) {
            if (key === "position" || key === "tags") continue;
            // Keys without (suggestable) values, e.g. "key:" or objects, are still suggested as keys
            const values = valueToStrings(value) ?? [];
            keys.set(key, { key, isList: Array.isArray(value), values: new Set(values) });
        }

        // Tags come from the whole note (front matter and inline), without the leading "#"
        const tags = getAllTags(cache);
        if (tags?.length)
            keys.set("tags", { key: "tags", isList: true, values: new Set(tags.map((t) => t.substring(1))) });
        this.fileKeys.set(file.path, keys);
    }

    removeFile(path: string) {
        if (this.fileKeys.delete(path)) this.merged = null;
    }

    renameFile(oldPath: string, newPath: string) {
        const keys = this.fileKeys.get(oldPath);
        if (!keys) return;
        this.fileKeys.delete(oldPath);
        this.fileKeys.set(newPath, keys);
    }
}
