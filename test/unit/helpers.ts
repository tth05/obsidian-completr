/**
 * Shared fakes for the unit tests.
 */
import { afterAll, afterEach, beforeAll, spyOn } from "bun:test";
import { type DataAdapter, type EditorPosition, Notice } from "obsidian";
import { DataFiles } from "../../src/data_files.ts";
import type { SuggestionContext } from "../../src/provider/provider.ts";
import { type CompletrSettings, DEFAULT_SETTINGS } from "../../src/settings.ts";
import { isWordChar, matchWordBackwards } from "../../src/text.ts";

export const PLUGIN_FOLDER = ".obsidian/plugins/obsidian-completr";

export function makeSettings(overrides: Partial<CompletrSettings> = {}): CompletrSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * In-memory implementation of the parts of Obsidian's DataAdapter that Completr uses. Paths are vault relative and use
 * "/" like in Obsidian.
 */
export class FakeAdapter {
    readonly files = new Map<string, string>();
    readonly folders = new Set<string>();
    /** Every write, in order. */
    readonly writes: [string, string][] = [];
    /** Paths for which read() rejects. */
    readonly failingReads = new Set<string>();
    /** Paths for which write() rejects, leaving the file as it is. */
    readonly failingWrites = new Set<string>();

    exists(path: string): Promise<boolean> {
        return Promise.resolve(this.files.has(path) || this.folders.has(path));
    }

    read(path: string): Promise<string> {
        if (this.failingReads.has(path)) return Promise.reject(new Error("EACCES: " + path));
        const content = this.files.get(path);
        if (content === undefined) return Promise.reject(new Error("ENOENT: no such file " + path));
        return Promise.resolve(content);
    }

    write(path: string, content: string): Promise<void> {
        if (this.failingWrites.has(path)) return Promise.reject(new Error("ENOSPC: " + path));
        this.files.set(path, content);
        this.writes.push([path, content]);
        return Promise.resolve();
    }

    remove(path: string): Promise<void> {
        if (!this.files.delete(path)) return Promise.reject(new Error("ENOENT: no such file " + path));
        return Promise.resolve();
    }

    mkdir(path: string): Promise<void> {
        this.folders.add(path);
        return Promise.resolve();
    }

    list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const children = (paths: Iterable<string>) =>
            [...paths].filter((p) => p.startsWith(path + "/") && !p.substring(path.length + 1).includes("/")).sort();
        return Promise.resolve({ files: children(this.files.keys()), folders: children(this.folders) });
    }
}

export function makeDataFiles(adapter = new FakeAdapter()): { files: DataFiles; adapter: FakeAdapter } {
    adapter.folders.add(PLUGIN_FOLDER);
    return { files: new DataFiles(adapter as unknown as DataAdapter, PLUGIN_FOLDER), adapter };
}

/** Vault relative path of a file in the plugin folder. */
export const pluginPath = (name: string) => PLUGIN_FOLDER + "/" + name;

/**
 * A minimal suggestion context for providers that only look at the query and flags. The cursor is outside of code and
 * math unless overridden, e.g. `makeContext("fr", { mathType: () => "inline" })`.
 */
export function makeContext(query: string, overrides: Partial<SuggestionContext> = {}): SuggestionContext {
    const line = overrides.line ?? query;
    const end: EditorPosition = overrides.end ?? { line: 0, ch: line.length };
    return {
        query,
        separatorChar: null,
        line,
        manual: false,
        inCode: false,
        mathType: () => null,
        end,
        editor: undefined as never,
        state: undefined as never,
        ...overrides,
    };
}

/**
 * The context the popup builds for a cursor position: `text` is the cursor's line with `|` marking the cursor. Query
 * and separator are the word in front of the cursor, like in the popup.
 */
export function makeContextAt(
    text: string,
    overrides: Partial<SuggestionContext> = {},
    settings: CompletrSettings = DEFAULT_SETTINGS,
): SuggestionContext {
    const ch = text.indexOf("|");
    if (ch === -1) throw new Error("No cursor marker in: " + text);
    const line = text.substring(0, ch) + text.substring(ch + 1);
    const { query, separatorChar } = matchWordBackwards(
        line,
        ch,
        (c) => isWordChar(c, settings.characterRegex),
        settings.maxLookBackDistance,
    );
    return makeContext(query, { separatorChar, line, end: { line: 0, ch }, ...overrides });
}

/** The messages of all notices shown so far (see the `Notice` stand-in in preload.ts). */
export function noticeMessages(): string[] {
    return (Notice as unknown as { messages: string[] }).messages;
}

/**
 * Replaces window.setTimeout/clearTimeout while the tests of the calling file/describe block run. Scheduled callbacks
 * only run when {@link FakeTimers.runAll} is called.
 */
export function useFakeTimers(): FakeTimers {
    const timers = new FakeTimers();
    const w = window as unknown as {
        setTimeout: (cb: () => void, ms?: number) => number;
        clearTimeout: (id?: number) => void;
    };
    let restore: (() => void) | null = null;
    beforeAll(() => {
        const set = spyOn(w, "setTimeout").mockImplementation((callback: () => void, delay?: number) =>
            timers.schedule(callback, delay ?? 0),
        );
        const clear = spyOn(w, "clearTimeout").mockImplementation((id?: number) => {
            if (id !== undefined) timers.pending.delete(id);
        });
        restore = () => {
            set.mockRestore();
            clear.mockRestore();
        };
    });
    afterEach(() => timers.pending.clear());
    afterAll(() => restore?.());
    return timers;
}

export class FakeTimers {
    private nextId = 1;
    readonly pending = new Map<number, { callback: () => void; delay: number }>();

    schedule(callback: () => void, delay: number): number {
        const id = this.nextId++;
        this.pending.set(id, { callback, delay });
        return id;
    }

    get delays(): number[] {
        return [...this.pending.values()].map((t) => t.delay);
    }

    runAll() {
        const timers = [...this.pending.values()];
        this.pending.clear();
        for (const t of timers) t.callback();
    }
}

/** Lets pending promise callbacks run. */
export function flushPromises(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
