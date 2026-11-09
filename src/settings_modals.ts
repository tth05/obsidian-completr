import { type App, type ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { CustomEntry } from "./provider/custom_suggestions.ts";

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
                b.onClick(async () => {
                    b.setDisabled(true);
                    await onConfirm();
                    this.close();
                });
            });
    }
}

export interface ListModalOptions<T> {
    title: string;
    /** Shown when there are no entries at all. */
    emptyText: string;
    items: () => readonly T[];
    name: (item: T) => string;
    description?: (item: T) => string | undefined;
    /** Shows an edit button. `index` is the index in {@link items}, `refresh` re-renders the list. */
    onEdit?: (item: T, index: number, refresh: () => void) => void;
    onRemove: (item: T, index: number) => Promise<void>;
    removeTooltip?: string;
    add?: { text: string; run: (refresh: () => void) => void };
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

        const toolbar = new Setting(this.contentEl).addSearch((search) =>
            search.setPlaceholder("Filter...").onChange((value) => {
                this.query = value.toLowerCase();
                this.render();
            }),
        );
        toolbar.settingEl.addClass("completr-list-toolbar");
        toolbar.infoEl.remove();
        if (opts.add) {
            const add = opts.add;
            toolbar.addButton((b) =>
                b
                    .setButtonText(add.text)
                    .setCta()
                    .onClick(() => add.run(() => this.render())),
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
            listEl.createDiv({ cls: "completr-list-message setting-item-description", text: opts.emptyText });
            return;
        }

        const matches: { item: T; index: number; name: string; description?: string }[] = [];
        items.forEach((item, index) => {
            const name = opts.name(item);
            const description = opts.description?.(item);
            if (
                !this.query ||
                name.toLowerCase().includes(this.query) ||
                description?.toLowerCase().includes(this.query)
            )
                matches.push({ item, index, name, description });
        });

        for (const { item, index, name, description } of matches.slice(0, LIST_LIMIT)) {
            const setting = new Setting(listEl).setName(name);
            setting.settingEl.addClass("completr-list-item");
            if (description) setting.setDesc(description);
            if (opts.onEdit) {
                const onEdit = opts.onEdit;
                setting.addExtraButton((b) =>
                    b
                        .setIcon("pencil")
                        .setTooltip("Edit")
                        .onClick(() => onEdit(item, index, () => this.render())),
                );
            }
            setting.addExtraButton((b) =>
                b
                    .setIcon("trash")
                    .setTooltip(opts.removeTooltip ?? "Remove")
                    .onClick(async () => {
                        await opts.onRemove(item, index);
                        this.render();
                    }),
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

export interface CustomEntryModalOptions {
    title: string;
    namePlaceholder: string;
    replacementPlaceholder: string;
    /** Explains the placeholder syntax of the replacement. */
    syntaxHelp: string;
    /** If false, the name defaults to the replacement. */
    nameRequired: boolean;
}

/** Adds or edits a custom LaTeX command or snippet. */
export class CustomEntryModal extends Modal {
    constructor(
        app: App,
        opts: CustomEntryModalOptions,
        initial: CustomEntry | null,
        onSubmit: (entry: CustomEntry) => Promise<void>,
    ) {
        super(app);
        this.setTitle(initial ? opts.title.replace(/^Add/, "Edit") : opts.title);
        let displayName = initial?.displayName ?? "";
        let replacement = initial?.replacement ?? "";
        new Setting(this.contentEl)
            .setName("Name")
            .setDesc(
                opts.nameRequired
                    ? "What you type to get this suggestion. Shown in the popup."
                    : "Shown in the popup and used for matching. Defaults to the replacement.",
            )
            .addText((t) =>
                t
                    .setPlaceholder(opts.namePlaceholder)
                    .setValue(displayName)
                    .onChange((v) => (displayName = v)),
            );
        new Setting(this.contentEl)
            .setName("Replacement")
            .setDesc(opts.syntaxHelp)
            .addTextArea((t) => {
                t.inputEl.rows = 5;
                t.inputEl.addClass("completr-replacement-input");
                t.setPlaceholder(opts.replacementPlaceholder)
                    .setValue(replacement)
                    .onChange((v) => (replacement = v));
            });
        new Setting(this.contentEl).addButton((b) =>
            b
                .setButtonText(initial ? "Save" : "Add")
                .setCta()
                .onClick(async () => {
                    if (!replacement.trim()) {
                        new Notice("The replacement can't be empty.");
                        return;
                    }
                    if (opts.nameRequired && !displayName.trim()) {
                        new Notice("The name can't be empty.");
                        return;
                    }
                    await onSubmit({
                        displayName: (displayName.trim() || replacement).replace(/\n/g, " "),
                        replacement,
                    });
                    this.close();
                }),
        );
    }
}
