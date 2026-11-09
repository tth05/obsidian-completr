/**
 * Drives Completr's settings tab. Settings are addressed by the heading of their group (null for the first group,
 * which has no heading) and their name.
 */
import { join } from "node:path";
import type { Obsidian } from "../harness/obsidian.ts";

interface SettingManager {
    open(): void;
    close(): void;
    openTabById(id: string): unknown;
    activeTab: { id: string; containerEl: HTMLElement } | null;
}

type FindSetting = (group: string | null, name: string | null) => HTMLElement;

declare global {
    interface Window {
        __e2eFindSetting?: FindSetting;
        __e2eFileInput?: HTMLInputElement | null;
    }
}

/**
 * Opens the settings modal on Completr's tab and waits until it is rendered.
 *
 * Obsidian 1.15 opens the settings in a separate (visible, focus stealing) window by default. They are opened as a
 * modal inside the off-screen main window instead, which also keeps everything in one `document`.
 */
export async function openCompletrSettings(obsidian: Obsidian) {
    await obsidian.eval(() => {
        app.plugins.plugins["obsidian-completr"]?.popup.close();
        const vault = app.vault as unknown as { getConfig(k: string): unknown; setConfig(k: string, v: unknown): void };
        if (vault.getConfig("settingsPopoutWindow") !== false) vault.setConfig("settingsPopoutWindow", false);
        const setting = (app as unknown as { setting: SettingManager }).setting;
        setting.open();
        setting.openTabById("obsidian-completr");

        window.__e2eFindSetting = (group, name) => {
            const container = setting.activeTab!.containerEl;
            const groups = Array.from(container.querySelectorAll<HTMLElement>(".setting-group"));
            const groupEl = groups.find((g) => {
                const heading = g.querySelector(".setting-item-heading .setting-item-name");
                return group === null ? !heading : heading?.textContent === group;
            });
            if (!groupEl) throw new Error("Setting group not found: " + group);
            if (name === null) return groupEl;
            const item = Array.from(
                groupEl.querySelectorAll<HTMLElement>(".setting-item:not(.setting-item-heading)"),
            ).find((s) => s.querySelector(".setting-item-name")?.textContent === name);
            if (!item) throw new Error(`Setting not found: ${group} > ${name}`);
            return item;
        };
    });
    await obsidian.waitFor(
        () =>
            obsidian.eval(() => {
                const tab = (app as unknown as { setting: SettingManager }).setting.activeTab;
                return tab?.id === "obsidian-completr" && tab.containerEl.querySelectorAll(".setting-group").length > 3;
            }),
        { what: "the settings tab" },
    );
}

export async function closeSettings(obsidian: Obsidian) {
    await obsidian.eval(() => (app as unknown as { setting: SettingManager }).setting.close());
}

/** Whether the settings tab of Completr is shown. */
export function isSettingsTabOpen(obsidian: Obsidian): Promise<boolean> {
    return obsidian.eval(() => {
        const tab = (app as unknown as { setting: SettingManager }).setting.activeTab;
        return tab?.id === "obsidian-completr" && tab.containerEl.isConnected;
    });
}

/** Names of the settings in a group, without unnamed ones (e.g. descriptions). */
export function settingNames(obsidian: Obsidian, group: string | null): Promise<string[]> {
    return obsidian.eval(
        (group: string | null) =>
            Array.from(
                window.__e2eFindSetting!(group, null).querySelectorAll(
                    ".setting-item:not(.setting-item-heading) .setting-item-name",
                ),
            )
                .map((n) => n.textContent ?? "")
                .filter((n) => n !== ""),
        group,
    );
}

export function groupHeadings(obsidian: Obsidian): Promise<string[]> {
    return obsidian.eval(() =>
        Array.from(
            (app as unknown as { setting: SettingManager }).setting.activeTab!.containerEl.querySelectorAll(
                ".setting-item-heading .setting-item-name",
            ),
        ).map((n) => n.textContent ?? ""),
    );
}

export async function clickToggle(obsidian: Obsidian, group: string | null, name: string) {
    await obsidian.eval(
        (group: string | null, name: string) =>
            window.__e2eFindSetting!(group, name).querySelector<HTMLElement>(".checkbox-container")!.click(),
        group,
        name,
    );
}

export function isToggleOn(obsidian: Obsidian, group: string | null, name: string): Promise<boolean> {
    return obsidian.eval(
        (group: string | null, name: string) =>
            window.__e2eFindSetting!(group, name)
                .querySelector(".checkbox-container")!
                .classList.contains("is-enabled"),
        group,
        name,
    );
}

/** Sets the value of a text input like typing would (fires an `input` event). Returns the input's class list. */
export function setTextInput(obsidian: Obsidian, group: string | null, name: string, value: string): Promise<string> {
    return obsidian.eval(
        (group: string | null, name: string, value: string) => {
            const input = window.__e2eFindSetting!(group, name).querySelector<HTMLInputElement>("input")!;
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return input.className;
        },
        group,
        name,
        value,
    );
}

export function getTextInput(obsidian: Obsidian, group: string | null, name: string): Promise<string> {
    return obsidian.eval(
        (group: string | null, name: string) =>
            window.__e2eFindSetting!(group, name).querySelector<HTMLInputElement>("input")!.value,
        group,
        name,
    );
}

/** Values of the options of a dropdown. */
export function dropdownOptions(obsidian: Obsidian, group: string | null, name: string): Promise<string[]> {
    return obsidian.eval(
        (group: string | null, name: string) =>
            Array.from(
                window.__e2eFindSetting!(group, name).querySelectorAll<HTMLOptionElement>(
                    "select.dropdown:not(.is-measuring) option",
                ),
            ).map((o) => o.value),
        group,
        name,
    );
}

export async function selectDropdown(obsidian: Obsidian, group: string | null, name: string, value: string) {
    await obsidian.eval(
        (group: string | null, name: string, value: string) => {
            const select = window.__e2eFindSetting!(group, name).querySelector<HTMLSelectElement>(
                "select.dropdown:not(.is-measuring)",
            )!;
            if (!Array.from(select.options).some((o) => o.value === value)) throw new Error("No such option: " + value);
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        },
        group,
        name,
        value,
    );
}

/** Clicks a button (by text) of a setting. */
export async function clickButton(obsidian: Obsidian, group: string | null, name: string | null, text: string) {
    await obsidian.eval(
        (group: string | null, name: string | null, text: string) => {
            const button = Array.from(window.__e2eFindSetting!(group, name).querySelectorAll("button")).find(
                (b) => b.textContent === text,
            );
            if (!button) throw new Error("Button not found: " + text);
            button.click();
        },
        group,
        name,
        text,
    );
}

/** Clicks an extra (icon) button by its tooltip. `name` null means the buttons of the group heading. */
export async function clickExtraButton(obsidian: Obsidian, group: string, name: string | null, tooltip: string) {
    await obsidian.eval(
        (group: string, name: string | null, tooltip: string) => {
            const el =
                name === null
                    ? window.__e2eFindSetting!(group, null).querySelector(".setting-item-heading")!
                    : window.__e2eFindSetting!(group, name);
            const button = Array.from(el.querySelectorAll<HTMLElement>(".extra-setting-button")).find(
                (b) => b.getAttribute("aria-label") === tooltip,
            );
            if (!button) throw new Error("Extra button not found: " + tooltip);
            button.click();
        },
        group,
        name,
        tooltip,
    );
}

/** Text of the topmost modal (on top of the settings), null if there is none. */
export function topModalText(obsidian: Obsidian): Promise<string | null> {
    return obsidian.eval(() => {
        const modals = Array.from(document.querySelectorAll(".modal:not(.mod-settings)"));
        return modals.at(-1)?.textContent ?? null;
    });
}

/** Clicks a button (by text) in the topmost modal that is not the settings. */
export async function clickModalButton(obsidian: Obsidian, text: string) {
    await obsidian.eval((text: string) => {
        const modal = Array.from(document.querySelectorAll(".modal:not(.mod-settings)")).at(-1);
        const button = Array.from(modal?.querySelectorAll("button") ?? []).find((b) => b.textContent === text);
        if (!button) throw new Error("Modal button not found: " + text);
        button.click();
    }, text);
}

/** Reads Completr's data.json from disk. */
export async function readDataJson(obsidian: Obsidian): Promise<Record<string, unknown>> {
    return (await Bun.file(join(obsidian.pluginDir, "data.json")).json()) as Record<string, unknown>;
}

/**
 * Clicks a button that opens a file dialog, and instead of showing the dialog, selects the given files in the file
 * input through CDP (`DOM.setFileInputFiles`), which fires the input's `change` event like a real selection.
 */
export async function chooseFiles(obsidian: Obsidian, clickButtonFn: () => Promise<void>, paths: string[]) {
    await obsidian.eval(() => {
        window.__e2eFileInput = null;
        // `click` is inherited from HTMLElement.prototype, shadow it on the input prototype only
        HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
            if (this.type === "file") window.__e2eFileInput = this;
            else HTMLElement.prototype.click.call(this);
        };
    });
    try {
        await clickButtonFn();
        await obsidian.waitFor(() => obsidian.eval(() => !!window.__e2eFileInput), { what: "the file input" });
        const { result } = await obsidian.cdp.send<{ result: { objectId: string } }>("Runtime.evaluate", {
            expression: "window.__e2eFileInput",
        });
        await obsidian.cdp.send("DOM.setFileInputFiles", { files: paths, objectId: result.objectId });
    } finally {
        await obsidian.eval(() => {
            delete (HTMLInputElement.prototype as Partial<HTMLInputElement>).click;
            window.__e2eFileInput = null;
        });
    }
}
