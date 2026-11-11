import type { DataFiles } from "../data_files.ts";

/** A user defined suggestion: custom LaTeX commands and snippets. */
export interface CustomEntry {
    /** Shown in the popup and matched against what is typed. */
    displayName: string;
    /** Inserted text, with placeholders in the syntax of the provider (see `SnippetSyntax`). */
    replacement: string;
}

/** How a kind of custom entries is called and explained in the UI. */
export interface CustomEntryKind {
    /** Title of the list, e.g. "Snippets". */
    title: string;
    /** One and several entries, e.g. ["snippet", "snippets"]. */
    noun: [singular: string, plural: string];
    /** Shown below the count in the settings. */
    description: string;
    /** Title of the dialog for a new entry, also the label of the button that opens it. */
    addTitle: string;
    editTitle: string;
    namePlaceholder: string;
    replacementPlaceholder: string;
    /** Explains the placeholder syntax of the replacement. */
    syntaxHelp: string;
    /** If false, the name defaults to the replacement. */
    nameRequired: boolean;
}

/** Parses a JSON array of strings (display name = replacement) or {displayName, replacement} objects. */
export function parseCustomEntries(json: string): CustomEntry[] {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) throw new Error("The JSON root must be an array");

    return data.map((entry: unknown, i): CustomEntry => {
        let result: CustomEntry | null = null;
        if (typeof entry === "string") result = { displayName: entry, replacement: entry };
        else if (entry && typeof entry === "object") {
            const { displayName, replacement } = entry as Partial<CustomEntry>;
            if (typeof displayName === "string" && typeof replacement === "string")
                result = { displayName, replacement };
        }
        if (!result) throw new Error(`Invalid entry at index ${i}: ${JSON.stringify(entry)}`);
        if (result.displayName.includes("\n"))
            throw new Error("Display name cannot contain a newline: " + result.displayName);
        return result;
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

    /** @param onChange called whenever the entries were loaded or changed. */
    constructor(
        private readonly files: DataFiles,
        readonly fileName: string,
        readonly kind: CustomEntryKind,
        private readonly onChange: () => void = () => {},
    ) {}

    get entries(): readonly CustomEntry[] {
        return this.items;
    }

    /** Why the file couldn't be loaded, null if it is fine. */
    get error(): string | null {
        return this.loadError;
    }

    /** Vault relative path of the file. */
    get path(): string {
        return this.files.path(this.fileName);
    }

    /** E.g. "1 snippet", "3 snippets". */
    get countLabel(): string {
        const count = this.items.length;
        return `${count} ${this.kind.noun[count === 1 ? 0 : 1]}`;
    }

    /** Loads the file, creating it if missing. Returns an error message if it is invalid. */
    async load(): Promise<string | null> {
        this.loadError = null;
        const contents = await this.files.read(this.fileName);
        if (contents === null) {
            this.items = [];
            await this.files.write(this.fileName, "[]");
        } else {
            try {
                this.items = parseCustomEntries(contents);
            } catch (e) {
                this.items = [];
                this.loadError = `Failed to load ${this.fileName}: ${(e as Error).message}`;
            }
        }
        this.onChange();
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
        this.onChange();
        await this.files.write(this.fileName, serializeCustomEntries(entries));
    }

    add(entry: CustomEntry): Promise<void> {
        return this.set([...this.items, entry]);
    }

    /** Replaces `old` (one of {@link entries}) with `entry`. If `old` is gone by now, `entry` is added. */
    replace(old: CustomEntry, entry: CustomEntry): Promise<void> {
        if (!this.items.includes(old)) return this.add(entry);
        return this.set(this.items.map((e) => (e === old ? entry : e)));
    }

    remove(entry: CustomEntry): Promise<void> {
        return this.set(this.items.filter((e) => e !== entry));
    }
}
