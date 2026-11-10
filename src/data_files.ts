import type { DataAdapter } from "obsidian";

/** Access to the files Completr keeps in its plugin folder (word lists, scanned words, ...). */
export class DataFiles {
    constructor(
        private readonly adapter: DataAdapter,
        /** Vault relative path of the plugin folder, e.g. `.obsidian/plugins/obsidian-completr`. */
        readonly folder: string,
    ) {}

    path(...segments: string[]): string {
        return [this.folder, ...segments].join("/");
    }

    async exists(name: string): Promise<boolean> {
        return this.adapter.exists(this.path(name));
    }

    async read(name: string): Promise<string | null> {
        const path = this.path(name);
        return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
    }

    async write(name: string, content: string): Promise<void> {
        await this.adapter.write(this.path(name), content);
    }

    async remove(name: string): Promise<void> {
        const path = this.path(name);
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
    }

    /**
     * Lists the files in a sub folder. The folder is created if it is missing, so users find it where the documentation
     * says it is. Returns names like the other methods take them, e.g. `wordLists/english.txt`.
     */
    async list(folder: string): Promise<string[]> {
        const path = this.path(folder);
        if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
        const prefix = this.folder + "/";
        return (await this.adapter.list(path)).files.map((f) =>
            f.startsWith(prefix) ? f.substring(prefix.length) : f,
        );
    }
}

/** Writes changes to disk at most once per `delay`, instead of on every change. */
export class DebouncedSaver {
    private timer: number | null = null;
    private dirty = false;

    constructor(
        private readonly save: () => Promise<void>,
        private readonly delay: number,
    ) {}

    /** Marks the data as changed. It is saved after the delay. */
    schedule() {
        this.dirty = true;
        this.timer ??= window.setTimeout(() => {
            this.timer = null;
            this.flush().catch((e) => console.error("Completr: Unable to save", e));
        }, this.delay);
    }

    /** Saves now, if there are unsaved changes. A failed save is retried with the next one. */
    async flush() {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        if (!this.dirty) return;
        this.dirty = false;
        try {
            await this.save();
        } catch (e) {
            this.dirty = true;
            throw e;
        }
    }
}

const NEW_LINE_REGEX = /\r?\n/;

export function splitLines(text: string): string[] {
    return text.split(NEW_LINE_REGEX);
}

/**
 * Decodes a text file of unknown encoding: UTF-8/UTF-16 with BOM, UTF-8 without BOM, otherwise Windows-1252 (which
 * also covers Latin-1).
 */
export function decodeText(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder("windows-1252").decode(bytes);
    }
}
