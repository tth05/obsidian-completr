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

    /** Lists the files in a sub folder (creating it if necessary). Returns vault relative paths. */
    async list(folder: string): Promise<string[]> {
        const path = this.path(folder);
        if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
        return (await this.adapter.list(path)).files;
    }

    readPath(vaultPath: string): Promise<string> {
        return this.adapter.read(vaultPath);
    }

    removePath(vaultPath: string): Promise<void> {
        return this.adapter.remove(vaultPath);
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
