/**
 * The settings in their default form: a popout window (Obsidian 1.15). Buttons are clicked with real mouse events in
 * that window, so things that depend on user activation (file dialogs) behave exactly like for a user.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CdpClient } from "./harness/cdp.ts";
import { getObsidian, type Obsidian, PLUGIN_ID } from "./harness/obsidian.ts";

let obsidian: Obsidian;
let settingsWindow: CdpClient;
let tempDir: string;

const WORD_LIST = "popout_import.txt";
const DROPPED_LIST = "popout_drop.txt";

beforeAll(async () => {
    obsidian = await getObsidian();
    await obsidian.resetSettings();
    tempDir = mkdtempSync(join(tmpdir(), "completr-popout-"));
    await obsidian.eval(() => {
        const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
        (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig("settingsPopoutWindow", true);
        setting.open();
        setting.openTabById("obsidian-completr");
    });
    settingsWindow = await obsidian.connectToWindow();
    await settingsWindow.send("Page.enable");
});

afterAll(async () => {
    settingsWindow?.close();
    await obsidian.eval(
        async (files: string[]) => {
            (app as unknown as { setting: { close(): void } }).setting.close();
            (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig(
                "settingsPopoutWindow",
                false,
            );
            for (const file of files) {
                const path = `.obsidian/plugins/obsidian-completr/wordLists/${file}`;
                if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
            }
            await app.plugins.plugins["obsidian-completr"]!.wordList.load(
                app.plugins.plugins["obsidian-completr"]!.settings,
            );
        },
        [WORD_LIST, DROPPED_LIST],
    );
    rmSync(tempDir, { recursive: true, force: true });
});

/** Clicks the button of a setting with a real mouse event inside the settings window. */
async function clickSettingButton(settingName: string, buttonText: string) {
    const rect = await settingsWindow.evaluate<{ x: number; y: number } | null>(`(() => {
        const setting = Array.from(document.querySelectorAll(".setting-item")).find(
            (s) => s.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(settingName)},
        );
        const button = Array.from(setting?.querySelectorAll("button") ?? []).find(
            (b) => b.textContent === ${JSON.stringify(buttonText)},
        );
        if (!button) return null;
        button.scrollIntoView({ block: "center" });
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) throw new Error(`Button "${buttonText}" of setting "${settingName}" not found`);
    for (const type of ["mousePressed", "mouseReleased"])
        await settingsWindow.send("Input.dispatchMouseEvent", { type, ...rect, button: "left", clickCount: 1 });
}

test("the settings open in a popout window", async () => {
    const title = await settingsWindow.evaluate<string>("document.title");
    expect(title).not.toBe("");
    expect(await settingsWindow.evaluate<boolean>(`!!document.querySelector(".vertical-tab-content")`)).toBe(true);
});

function wordListShownInSettings(name: string) {
    return obsidian.waitFor(
        () =>
            settingsWindow.evaluate<boolean>(
                `Array.from(document.querySelectorAll(".setting-item-name")).some((n) => n.textContent === ${JSON.stringify(name)})`,
            ),
        { what: `${name} in the settings` },
    );
}

test("word lists can be dropped onto the word list setting", async () => {
    const file = join(tempDir, DROPPED_LIST);
    writeFileSync(file, "popoutdroppedword\n");

    const target = await settingsWindow.evaluate<{ x: number; y: number }>(`(() => {
        const setting = Array.from(document.querySelectorAll(".setting-item")).find(
            (s) => s.querySelector(".setting-item-name")?.textContent === "Word list files",
        );
        setting.scrollIntoView({ block: "center" });
        const r = setting.getBoundingClientRect();
        return { x: r.x + r.width / 3, y: r.y + r.height / 2 };
    })()`);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    await settingsWindow.send("Input.dispatchDragEvent", { type: "dragEnter", ...target, data });
    await settingsWindow.send("Input.dispatchDragEvent", { type: "dragOver", ...target, data });
    expect(
        await settingsWindow.evaluate<boolean>(`!!document.querySelector(".completr-drop-target.is-dragging-over")`),
    ).toBe(true);
    await settingsWindow.send("Input.dispatchDragEvent", { type: "drop", ...target, data });

    await obsidian.waitFor(() => obsidian.readVaultFile(`.obsidian/plugins/${PLUGIN_ID}/wordLists/${DROPPED_LIST}`), {
        timeout: 5_000,
        what: "the dropped word list",
    });
    await wordListShownInSettings(DROPPED_LIST);
    expect(await settingsWindow.evaluate<boolean>(`!!document.querySelector(".is-dragging-over")`)).toBe(false);
});

test("Import opens a file dialog and imports the chosen word list", async () => {
    const file = join(tempDir, WORD_LIST);
    writeFileSync(file, "popoutimportone\npopoutimporttwo\n");

    await settingsWindow.send("Page.setInterceptFileChooserDialog", { enabled: true });
    const chooser = settingsWindow.waitForEvent<{ backendNodeId: number; mode: string }>("Page.fileChooserOpened");
    await clickSettingButton("Word list files", "Import");
    const { backendNodeId, mode } = await chooser;
    expect(mode).toBe("selectMultiple");
    await settingsWindow.send("DOM.setFileInputFiles", { files: [file], backendNodeId });

    await obsidian.waitFor(() => obsidian.readVaultFile(`.obsidian/plugins/${PLUGIN_ID}/wordLists/${WORD_LIST}`), {
        timeout: 5_000,
        what: "the imported word list",
    });
    await wordListShownInSettings(WORD_LIST);

    await obsidian.eval(() => (app as unknown as { setting: { close(): void } }).setting.close());
    await obsidian.openNote("<|>", { path: "popout-import.md" });
    await obsidian.type("popoutimp");
    const popup = await obsidian.waitForPopup((p) => p.items.length === 2);
    expect(popup.items.sort()).toEqual(["popoutimportone", "popoutimporttwo"]);
});
