import { type DataFiles, splitLines } from "../data_files.ts";

const BLACKLIST_FILE = "blacklisted_suggestions.txt";

/** Suggestions (by display name) that should never be shown. Stored one per line in the plugin folder. */
export class SuggestionBlacklist {
    private readonly entries = new Set<string>();

    constructor(private readonly files: DataFiles) {}

    get size(): number {
        return this.entries.size;
    }

    has(text: string): boolean {
        return this.entries.has(text);
    }

    values(): string[] {
        return [...this.entries];
    }

    async add(text: string) {
        if (!text || this.entries.has(text)) return;
        this.entries.add(text);
        await this.save();
    }

    async addAll(texts: Iterable<string>) {
        let changed = false;
        for (const text of texts) {
            if (!text || this.entries.has(text)) continue;
            this.entries.add(text);
            changed = true;
        }
        if (changed) await this.save();
    }

    async remove(text: string) {
        if (this.entries.delete(text)) await this.save();
    }

    private async save() {
        await this.files.write(BLACKLIST_FILE, [...this.entries].join("\n"));
    }

    async load() {
        this.entries.clear();
        const contents = await this.files.read(BLACKLIST_FILE);
        if (contents === null) return;
        for (const line of splitLines(contents)) {
            if (line) this.entries.add(line);
        }
    }
}
