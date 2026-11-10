import { type DataFiles, DebouncedSaver } from "./data_files.ts";

const USAGE_FILE = "suggestion_usage.json";
const SAVE_DELAY_MS = 5000;
/** Keep the file small: only the most used entries survive. */
const MAX_ENTRIES = 5000;

/** Counts how often each suggestion was inserted, so frequently used ones can be ranked higher. */
export class SuggestionUsage {
    private counts = new Map<string, number>();
    private readonly saver: DebouncedSaver;

    constructor(private readonly files: DataFiles) {
        this.saver = new DebouncedSaver(() => this.save(), SAVE_DELAY_MS);
    }

    get size(): number {
        return this.counts.size;
    }

    get(displayName: string): number {
        return this.counts.get(displayName) ?? 0;
    }

    record(displayName: string) {
        this.counts.set(displayName, this.get(displayName) + 1);
        this.saver.schedule();
    }

    /** Forgets all counts. */
    async clear() {
        this.counts.clear();
        this.saver.schedule();
        await this.saver.flush();
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

    /** Writes pending changes to disk. */
    flush(): Promise<void> {
        return this.saver.flush();
    }

    private async save() {
        let entries = [...this.counts];
        if (entries.length > MAX_ENTRIES) {
            entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
            this.counts = new Map(entries);
        }
        await this.files.write(USAGE_FILE, JSON.stringify(Object.fromEntries(entries)));
    }
}
