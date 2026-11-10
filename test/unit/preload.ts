/**
 * The `obsidian` package only contains typings, the real implementation lives inside the app. Unit tests get this
 * minimal stand-in. Extend it when a tested module needs more.
 */
import { mock } from "bun:test";

class Notice {
    static messages: string[] = [];
    constructor(message: string) {
        Notice.messages.push(message);
    }
}

/** Tests may change the flags. */
const Platform = { isMacOS: false };

void mock.module("obsidian", () => ({
    Notice,
    Platform,
    /** Same semantics as Obsidian: front matter tags + inline tags, with a leading "#". */
    getAllTags(cache: { frontmatter?: { tags?: unknown }; tags?: { tag: string }[] }): string[] | null {
        const tags: string[] = [];
        const fm = cache.frontmatter?.tags;
        for (const t of Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : []) {
            if (typeof t === "string" && t) tags.push(t.startsWith("#") ? t : "#" + t);
        }
        for (const t of cache.tags ?? []) tags.push(t.tag);
        return tags;
    },
    debounce<T extends unknown[]>(fn: (...args: T) => unknown) {
        return Object.assign((...args: T) => fn(...args), { cancel() {}, run() {} });
    },
    renderMatches() {},
    setIcon() {},
    Plugin: class {},
    PluginSettingTab: class {},
    EditorSuggest: class {},
    Modal: class {},
    Setting: class {},
    SettingGroup: class {},
    MarkdownView: class {},
    TFile: class {},
}));

// Modules use window.setTimeout (the Obsidian runtime is a browser)
(globalThis as { window?: unknown }).window ??= globalThis;
