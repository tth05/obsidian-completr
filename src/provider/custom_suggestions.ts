import type { DataFiles } from "../data_files.ts";

/** A user defined suggestion: custom LaTeX commands and snippets. */
export interface CustomEntry {
    /** Shown in the popup and matched against what is typed. */
    displayName: string;
    /** Inserted text. "#" marks placeholders, "~" the final cursor position. */
    replacement: string;
}

/** Parses a JSON array of strings (display name = replacement) or {displayName, replacement} objects. */
export function parseCustomEntries(json: string): CustomEntry[] {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) throw new Error("The JSON root must be an array");

    return data.map((entry: unknown, i) => {
        if (typeof entry === "string") return { displayName: entry, replacement: entry };
        if (entry && typeof entry === "object") {
            const { displayName, replacement } = entry as Partial<CustomEntry>;
            if (typeof displayName === "string" && typeof replacement === "string") {
                if (displayName.includes("\n"))
                    throw new Error("Display name cannot contain a newline: " + displayName);
                return { displayName, replacement };
            }
        }
        throw new Error(`Invalid entry at index ${i}: ${JSON.stringify(entry)}`);
    });
}

export function serializeCustomEntries(entries: readonly CustomEntry[]): string {
    return JSON.stringify(
        entries.map((c) => (c.displayName === c.replacement ? c.displayName : c)),
        null,
        2,
    );
}

/** A list of {@link CustomEntry}s stored as JSON in the plugin folder. */
export class CustomEntryFile {
    private items: CustomEntry[] = [];
    /** Set if the file couldn't be parsed. It is backed up before being overwritten. */
    private loadError: string | null = null;

    constructor(
        private readonly files: DataFiles,
        readonly fileName: string,
    ) {}

    get entries(): readonly CustomEntry[] {
        return this.items;
    }

    /** Loads the file, creating it if missing. Returns an error message if it is invalid. */
    async load(): Promise<string | null> {
        this.loadError = null;
        const contents = await this.files.read(this.fileName);
        if (contents === null) {
            this.items = [];
            await this.files.write(this.fileName, "[]");
            return null;
        }

        try {
            this.items = parseCustomEntries(contents);
        } catch (e) {
            this.items = [];
            this.loadError = `Failed to load ${this.fileName}: ${(e as Error).message}`;
        }
        return this.loadError;
    }

    async set(entries: CustomEntry[]) {
        if (this.loadError) {
            // Don't lose what the user wrote into the broken file
            const contents = await this.files.read(this.fileName);
            if (contents !== null) await this.files.write(this.fileName + ".broken.bak", contents);
            this.loadError = null;
        }
        this.items = entries;
        await this.files.write(this.fileName, serializeCustomEntries(entries));
    }
}
