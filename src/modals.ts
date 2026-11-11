import { type App, type ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { guarded } from "./errors.ts";
import type { CustomEntry, CustomEntryFile } from "./provider/custom_suggestions.ts";
import { summarize } from "./text.ts";

/** Lists show at most this many entries, the search narrows them down. */
const LIST_LIMIT = 100;

export class ConfirmationModal extends Modal {
    constructor(
        app: App,
        title: string,
        body: string,
        configureButton: (button: ButtonComponent) => void,
        onConfirm: () => Promise<unknown>,
    ) {
        super(app);
        this.setTitle(title);
        this.contentEl.createEl("p", { text: body });
        new Setting(this.contentEl)
            .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((b) => {
                configureButton(b);
                b.onClick(
                    guarded(async () => {
                        b.setDisabled(true);
                        try {
                            await onConfirm();
                        } finally {
                            this.close();
                        }
                    }),
                );
            });
    }
}

export interface ListModalOptions<T> {
    title: string;
    /** Shown when there are no entries at all. */
    emptyText: () => string;
    items: () => readonly T[];
    name: (item: T) => string;
    description?: (item: T) => string | undefined;
    /** Shows an edit button. `refresh` re-renders the list. */
    onEdit?: (item: T, refresh: () => void) => void;
    onRemove: (item: T) => Promise<unknown>;
    removeTooltip?: string;
    /** The main button next to the filter. */
    add?: { text: string; run: (refresh: () => void) => void };
    /** Icon buttons next to the filter. */
    actions?: { icon: string; tooltip: string; run: () => unknown }[];
    /** Called when the modal is closed, e.g. to update counts in the settings. */
    onClose?: () => void;
}

/** A searchable list of entries with edit/remove buttons. Used for lists that can grow long (blacklist, snippets, ...). */
export class ListModal<T> extends Modal {
    private query = "";
    private readonly listEl: HTMLElement;

    constructor(
        app: App,
        private readonly opts: ListModalOptions<T>,
    ) {
        super(app);
        this.setTitle(opts.title);
        this.modalEl.addClass("completr-list-modal");
        const refresh = () => this.render();

        const toolbar = new Setting(this.contentEl).addSearch((search) =>
            search.setPlaceholder("Filter...").onChange((value) => {
                this.query = value.toLowerCase();
                this.render();
            }),
        );
        toolbar.settingEl.addClass("completr-list-toolbar");
        toolbar.infoEl.remove();
        for (const action of opts.actions ?? []) {
            toolbar.addExtraButton((b) =>
                b
                    .setIcon(action.icon)
                    .setTooltip(action.tooltip)
                    .onClick(
                        guarded(async () => {
                            await action.run();
                            this.render();
                        }),
                    ),
            );
        }
        if (opts.add) {
            const add = opts.add;
            toolbar.addButton((b) =>
                b
                    .setButtonText(add.text)
                    .setCta()
                    .onClick(() => add.run(refresh)),
            );
        }
        this.listEl = this.contentEl.createDiv({ cls: "completr-list" });
    }

    override onOpen() {
        this.render();
    }

    override onClose() {
        this.opts.onClose?.();
    }

    private render() {
        const { opts, listEl } = this;
        listEl.empty();

        const items = opts.items();
        if (items.length === 0) {
            listEl.createDiv({ cls: "completr-list-message setting-item-description", text: opts.emptyText() });
            return;
        }

        const matches: { item: T; name: string; description?: string }[] = [];
        for (const item of items) {
            const name = opts.name(item);
            const description = opts.description?.(item);
            if (
                !this.query ||
                name.toLowerCase().includes(this.query) ||
                description?.toLowerCase().includes(this.query)
            )
                matches.push({ item, name, description });
        }

        for (const { item, name, description } of matches.slice(0, LIST_LIMIT)) {
            const setting = new Setting(listEl).setName(name);
            setting.settingEl.addClass("completr-list-item");
            if (description) setting.setDesc(description);
            if (opts.onEdit) {
                const onEdit = opts.onEdit;
                setting.addExtraButton((b) =>
                    b
                        .setIcon("pencil")
                        .setTooltip("Edit")
                        .onClick(() => onEdit(item, () => this.render())),
                );
            }
            setting.addExtraButton((b) =>
                b
                    .setIcon("trash")
                    .setTooltip(opts.removeTooltip ?? "Remove")
                    .onClick(
                        guarded(async () => {
                            await opts.onRemove(item);
                            this.render();
                        }),
                    ),
            );
        }

        const text =
            matches.length === 0
                ? "Nothing matches the filter."
                : matches.length > LIST_LIMIT
                  ? `Showing ${LIST_LIMIT} of ${matches.length} entries. Use the filter to find others.`
                  : matches.length < items.length
                    ? `${matches.length} of ${items.length} entries`
                    : null;
        if (text) listEl.createDiv({ cls: "completr-list-message setting-item-description", text });
    }
}

/** Adds or edits a custom LaTeX command or snippet. */
export class CustomEntryModal extends Modal {
    /**
     * @param opts.existing the entry to edit; without it a new one is added, pre-filled with `draft`.
     * @param opts.onDone called after the entry was saved.
     */
    constructor(
        app: App,
        file: CustomEntryFile,
        opts: { existing?: CustomEntry; draft?: Partial<CustomEntry>; onDone?: () => void } = {},
    ) {
        super(app);
        const { kind } = file;
        const { existing } = opts;
        this.setTitle(existing ? kind.editTitle : kind.addTitle);

        let displayName = existing?.displayName ?? opts.draft?.displayName ?? "";
        let replacement = existing?.replacement ?? opts.draft?.replacement ?? "";
        new Setting(this.contentEl)
            .setName("Name")
            .setDesc(
                kind.nameRequired
                    ? "What you type to get this suggestion. Shown in the popup."
                    : "Shown in the popup and used for matching. Defaults to the replacement.",
            )
            .addText((t) =>
                t
                    .setPlaceholder(kind.namePlaceholder)
                    .setValue(displayName)
                    .onChange((v) => (displayName = v)),
            );
        new Setting(this.contentEl)
            .setName("Replacement")
            .setDesc(kind.syntaxHelp)
            .addTextArea((t) => {
                t.inputEl.rows = 5;
                t.inputEl.addClass("completr-replacement-input");
                t.setPlaceholder(kind.replacementPlaceholder)
                    .setValue(replacement)
                    .onChange((v) => (replacement = v));
            });
        new Setting(this.contentEl).addButton((b) =>
            b
                .setButtonText(existing ? "Save" : "Add")
                .setCta()
                .onClick(
                    guarded(async () => {
                        if (!replacement.trim()) {
                            new Notice("The replacement can't be empty.");
                            return;
                        }
                        if (kind.nameRequired && !displayName.trim()) {
                            new Notice("The name can't be empty.");
                            return;
                        }
                        const entry: CustomEntry = {
                            displayName: (displayName.trim() || replacement).replace(/\n/g, " "),
                            replacement,
                        };
                        // Suggestions are told apart by their name, a second one would never be shown
                        if (file.entries.some((e) => e !== existing && e.displayName === entry.displayName)) {
                            new Notice(`There already is a ${kind.noun[0]} named "${entry.displayName}".`);
                            return;
                        }

                        if (existing) await file.replace(existing, entry);
                        else await file.add(entry);
                        this.close();
                        opts.onDone?.();
                    }),
                ),
        );
    }
}

/** Opens the list of a kind of custom entries (custom LaTeX commands, snippets) to add, edit and remove them. */
export function openCustomEntryList(app: App, file: CustomEntryFile, onClose?: () => void) {
    const { kind } = file;
    new ListModal<CustomEntry>(app, {
        title: kind.title,
        emptyText: () => file.error ?? `No ${kind.noun[1]} yet.`,
        items: () => file.entries,
        name: (entry) => entry.displayName,
        description: (entry) => (entry.replacement !== entry.displayName ? summarize(entry.replacement, 2) : undefined),
        onEdit: (entry, refresh) => new CustomEntryModal(app, file, { existing: entry, onDone: refresh }).open(),
        onRemove: (entry) => file.remove(entry),
        add: { text: kind.addTitle, run: (refresh) => new CustomEntryModal(app, file, { onDone: refresh }).open() },
        actions: [
            {
                icon: "file-json",
                tooltip: `Open ${file.fileName} in the default app`,
                run: () => app.openWithDefaultApp(file.path),
            },
            {
                icon: "refresh-cw",
                tooltip: `Reload ${file.fileName}`,
                run: async () => {
                    const error = await file.load();
                    new Notice(error ?? `Completr: Loaded ${file.countLabel} from ${file.fileName}`);
                },
            },
        ],
        onClose,
    }).open();
}
