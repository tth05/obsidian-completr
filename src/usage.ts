import type { DataFiles } from "./data_files.ts";

const USAGE_FILE = "suggestion_usage.json";
const SAVE_DELAY_MS = 5000;
/** Keep the file small: only the most used entries survive. */
const MAX_ENTRIES = 5000;

/** Counts how often each suggestion was inserted, so frequently used ones can be ranked higher. */
export class SuggestionUsage {
    private counts = new Map<string, number>();
    private saveTimer: number | null = null;
    private dirty = false;

    constructor(private readonly files: DataFiles) {}

    get(displayName: string): number {
        return this.counts.get(displayName) ?? 0;
    }

    record(displayName: string) {
        this.counts.set(displayName, this.get(displayName) + 1);
        this.dirty = true;
        this.saveTimer ??= window.setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, SAVE_DELAY_MS);
    }

    clear() {
        this.counts.clear();
        this.dirty = true;
        void this.flush();
    }

    async load() {
        const contents = await this.files.read(USAGE_FILE);
        if (!contents) return;
        try {
            const data = JSON.parse(contents) as Record<string, number>;
            this.counts = new Map(Object.entries(data).filter(([, v]) => typeof v === "number"));
        } catch (e) {
            console.warn("Completr: Unable to read " + USAGE_FILE, e);
        }
    }

    async flush() {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.dirty) return;
        this.dirty = false;

        let entries = [...this.counts];
        if (entries.length > MAX_ENTRIES) {
            entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
            this.counts = new Map(entries);
        }
        await this.files.write(USAGE_FILE, JSON.stringify(Object.fromEntries(entries)));
    }
}
