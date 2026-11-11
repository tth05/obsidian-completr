/**
 * Launches a throw-away Obsidian instance (own profile, own vault, random debugging port) with the freshly built plugin
 * installed, and provides helpers to drive it like a user would.
 *
 * Environment variables:
 * - OBSIDIAN_EXE: path to the Obsidian executable (auto-detected otherwise)
 * - OBSIDIAN_ASAR: path to an obsidian-x.y.z.asar to run (defaults to the newest one the local installation downloaded)
 * - E2E_HEADED=1: keep the window visible instead of moving it off-screen
 * - E2E_KEEP=1: don't kill Obsidian / delete the temp dir after the run (for debugging)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../../../scripts/build.ts";
import { CdpClient } from "./cdp.ts";
import "./page-globals.ts";
import type { CompletrSettings } from "../../../src/settings.ts";

export const PLUGIN_ID = "obsidian-completr";
/** Marks the cursor position in note contents passed to {@link Obsidian.openNote}. */
export const CURSOR = "<|>";

export interface PopupState {
    visible: boolean;
    items: string[];
    /** Index of the item with the `is-selected` class, -1 if none. */
    selected: number;
}

export interface EditorState {
    text: string;
    /** Absolute offset of the main cursor. */
    cursor: number;
    /** {@link text} with {@link CURSOR} inserted at the cursor position. */
    textWithCursor: string;
}

type Modifier = "Ctrl" | "Shift" | "Alt" | "Meta";

const SPECIAL_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
    Enter: { code: "Enter", keyCode: 13, text: "\r" },
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Backspace: { code: "Backspace", keyCode: 8 },
    Delete: { code: "Delete", keyCode: 46 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
    PageUp: { code: "PageUp", keyCode: 33 },
    PageDown: { code: "PageDown", keyCode: 34 },
    " ": { code: "Space", keyCode: 32, text: " " },
};

const MODIFIER_BITS: Record<Modifier, number> = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };

function findObsidianExe(): string {
    if (process.env.OBSIDIAN_EXE) return process.env.OBSIDIAN_EXE;
    const candidates =
        process.platform === "win32"
            ? [
                  join(process.env.LOCALAPPDATA ?? "", "Obsidian", "Obsidian.exe"),
                  join(process.env.LOCALAPPDATA ?? "", "Programs", "Obsidian", "Obsidian.exe"),
                  join(process.env.ProgramFiles ?? "", "Obsidian", "Obsidian.exe"),
              ]
            : process.platform === "darwin"
              ? ["/Applications/Obsidian.app/Contents/MacOS/Obsidian"]
              : ["/usr/bin/obsidian", "/opt/Obsidian/obsidian", join(homedir(), ".local/bin/obsidian")];
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error("Obsidian not found. Set OBSIDIAN_EXE. Tried: " + candidates.join(", "));
    return found;
}

/** The installer often ships an old app version; the up-to-date one lives as an asar in the user config dir. */
function findNewestAsar(): string | null {
    if (process.env.OBSIDIAN_ASAR) return process.env.OBSIDIAN_ASAR;
    const configDir =
        process.platform === "win32"
            ? join(process.env.APPDATA ?? "", "obsidian")
            : process.platform === "darwin"
              ? join(homedir(), "Library", "Application Support", "obsidian")
              : join(homedir(), ".config", "obsidian");
    if (!existsSync(configDir)) return null;
    const asars = readdirSync(configDir)
        .map((f) => /^obsidian-(\d+)\.(\d+)\.(\d+)\.asar$/.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .sort((a, b) => {
            for (let i = 1; i <= 3; i++) {
                const d = Number(b[i]) - Number(a[i]);
                if (d !== 0) return d;
            }
            return 0;
        });
    return asars[0] ? join(configDir, asars[0][0]) : null;
}

async function waitUntil<T>(
    fn: () => Promise<T | null | undefined> | T | null | undefined,
    timeoutMs: number,
    what: string,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastError: Error | undefined;
    while (Date.now() < deadline) {
        try {
            const v = await fn();
            if (v) return v;
        } catch (e) {
            lastError = e as Error;
        }
        await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting for ${what}` + (lastError ? `: ${lastError.message}` : ""));
}

export class Obsidian {
    private constructor(
        readonly cdp: CdpClient,
        /** The DevTools port, to connect to other windows (e.g. popouts). */
        private readonly port: string,
        private readonly proc: Bun.Subprocess,
        /** Root temp directory containing the vault and the Obsidian profile. */
        readonly baseDir: string,
        /** Absolute path of the test vault. */
        readonly vaultDir: string,
    ) {}

    /** Absolute path of the plugin folder inside the test vault. */
    get pluginDir() {
        return join(this.vaultDir, ".obsidian", "plugins", PLUGIN_ID);
    }

    static async launch(): Promise<Obsidian> {
        const baseDir = mkdtempSync(join(tmpdir(), "completr-e2e-"));
        const vaultDir = join(baseDir, "vault");
        const profileDir = join(baseDir, "profile");
        const pluginDir = join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
        mkdirSync(pluginDir, { recursive: true });
        mkdirSync(profileDir, { recursive: true });

        await build({ production: false, outdir: pluginDir });
        const obsidianDir = join(vaultDir, ".obsidian");
        writeFileSync(join(obsidianDir, "community-plugins.json"), JSON.stringify([PLUGIN_ID]));
        writeFileSync(
            join(obsidianDir, "app.json"),
            JSON.stringify({ livePreview: true, promptDelete: false, settingsPopoutWindow: false }),
        );

        const asar = findNewestAsar();
        if (asar) await Bun.write(join(profileDir, asar.split(/[\\/]/).pop()!), Bun.file(asar));
        const vaultId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
            b.toString(16).padStart(2, "0"),
        ).join("");
        writeFileSync(
            join(profileDir, "obsidian.json"),
            JSON.stringify({ vaults: { [vaultId]: { path: vaultDir, ts: Date.now(), open: true } } }),
        );

        const proc = Bun.spawn(
            [
                findObsidianExe(),
                `--user-data-dir=${profileDir}`,
                "--remote-debugging-port=0",
                // Keep timers (debounces!) running at full speed while the window is in the background.
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
            ],
            { stdout: "ignore", stderr: "ignore" },
        );

        let obsidian: Obsidian | undefined;
        try {
            const port = await waitUntil(
                async () => {
                    const f = Bun.file(join(profileDir, "DevToolsActivePort"));
                    return (await f.exists()) ? (await f.text()).split("\n")[0]?.trim() : null;
                },
                30_000,
                "the DevTools port",
            );
            const wsUrl = await waitUntil(
                async () => {
                    const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
                        url: string;
                        webSocketDebuggerUrl: string;
                    }[];
                    return pages.find((p) => p.url.startsWith("app://obsidian.md/index.html"))?.webSocketDebuggerUrl;
                },
                30_000,
                "the Obsidian window",
            );
            const cdp = await CdpClient.connect(wsUrl);
            obsidian = new Obsidian(cdp, port, proc, baseDir, vaultDir);
            // CodeMirror only reports focus if the document has OS focus, which a background test window never has.
            await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

            await waitUntil(
                () => cdp.evaluate<boolean>("!!window.app?.workspace?.layoutReady"),
                30_000,
                "layout ready",
            );
            // A fresh vault opens a "trust this vault?" modal. Close it properly (Escape), removing its DOM would
            // leave its focus-trapping keymap scope active.
            for (
                let i = 0;
                i < 5 && (await cdp.evaluate<boolean>(`!!document.querySelector(".modal-container, body > .modal")`));
                i++
            ) {
                await obsidian.press("Escape");
                await Bun.sleep(100);
            }
            // Trust the vault / leave restricted mode, which loads the plugins listed in community-plugins.json.
            await cdp.evaluate(`(async () => {
                localStorage.setItem("enable-plugin-" + app.appId, "true");
                await app.plugins.setEnable(true);
            })()`);
            await waitUntil(
                () => cdp.evaluate<boolean>(`!!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?._loaded`),
                15_000,
                "the plugin to load",
            );
            if (!process.env.E2E_HEADED) await obsidian.hideWindow();
            await obsidian.snapshotDefaultSettings();
            return obsidian;
        } catch (e) {
            if (obsidian) await obsidian.shutdown();
            else Obsidian.killProcessTree(proc);
            throw e;
        }
    }

    private static killProcessTree(proc: Bun.Subprocess) {
        if (proc.exitCode !== null) return;
        if (process.platform === "win32") Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"]);
        else proc.kill("SIGKILL");
    }

    async shutdown() {
        if (process.env.E2E_KEEP) {
            console.log("E2E_KEEP set, leaving Obsidian running. Temp dir: " + this.baseDir);
            return;
        }
        try {
            this.cdp.close();
        } catch {
            /* ignore */
        }
        Obsidian.killProcessTree(this.proc);
        await this.proc.exited;
        // Electron child processes may hold file handles for a moment after the main process dies.
        for (let i = 0; i < 20; i++) {
            try {
                rmSync(this.baseDir, { recursive: true, force: true });
                return;
            } catch {
                await Bun.sleep(100);
            }
        }
    }

    /** Moves the window off-screen so tests don't steal the screen, while keeping it fully "visible" to Chromium. */
    private async hideWindow() {
        await this.cdp.evaluate(`(() => {
            try {
                const win = require("@electron/remote").getCurrentWindow();
                win.setPosition(-32000, -32000);
            } catch (e) { console.warn("Unable to hide window", e); }
        })()`);
    }

    // ---- Generic helpers ----------------------------------------------------------------------------------------

    /** Evaluates `fn` inside Obsidian. `fn` is serialized, so it can only use its arguments and page globals (`app`). */
    eval<T, A extends unknown[] = []>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<Awaited<T>> {
        return this.cdp.evaluate<Awaited<T>>(`(${fn.toString()})(...${JSON.stringify(args)})`);
    }

    waitFor<T>(
        fn: () => Promise<T | null | undefined> | T | null | undefined,
        opts: { timeout?: number; what?: string } = {},
    ) {
        return waitUntil(fn, opts.timeout ?? 2_000, opts.what ?? "condition");
    }

    /**
     * Connects to another Obsidian window (e.g. the settings, which open in a popout window by default). The caller
     * must close the client.
     */
    async connectToWindow(
        matches: (page: { title: string; url: string }) => boolean = (p) =>
            !p.url.startsWith("app://obsidian.md/index.html"),
    ): Promise<CdpClient> {
        const url = await this.waitFor(
            async () => {
                const pages = (await (await fetch(`http://127.0.0.1:${this.port}/json`)).json()) as {
                    type: string;
                    title: string;
                    url: string;
                    webSocketDebuggerUrl: string;
                }[];
                return pages.find((p) => p.type === "page" && matches(p))?.webSocketDebuggerUrl;
            },
            { timeout: 5_000, what: "another window" },
        );
        const client = await CdpClient.connect(url);
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
        return client;
    }

    // ---- Notes and editor ---------------------------------------------------------------------------------------

    /**
     * Opens (and creates/overwrites) a note with the given content in the active leaf, puts the cursor at
     * {@link CURSOR} (or the end) and focuses the editor. Closes any open popup first.
     */
    async openNote(content: string, opts: { path?: string; sourceMode?: boolean } = {}) {
        const cursor = content.indexOf(CURSOR);
        const text = content.replace(CURSOR, "");
        await this.eval(
            async (path: string, text: string, cursor: number, sourceMode: boolean) => {
                app.plugins.plugins["obsidian-completr"]?.popup.close();
                const existing = app.vault.getFileByPath(path);
                const file = existing ?? (await app.vault.create(path, text));
                if (existing) await app.vault.modify(existing, text);
                const leaf = app.workspace.getLeaf(false);
                await leaf.setViewState({
                    type: "markdown",
                    state: { file: file.path, mode: "source", source: sourceMode },
                    active: true,
                });
                const editor = (leaf.view as import("obsidian").MarkdownView).editor;
                // `modify` reloads the view asynchronously, setValue makes the content deterministic right away.
                if (editor.getValue() !== text) editor.setValue(text);
                editor.setCursor(editor.offsetToPos(cursor < 0 ? text.length : cursor));
                editor.focus();
            },
            opts.path ?? "test.md",
            text,
            cursor,
            opts.sourceMode ?? false,
        );
        // Let the editor settle so the initial cursor placement doesn't interfere with the following input.
        await Bun.sleep(30);
    }

    async editor(): Promise<EditorState> {
        const [text, cursor] = await this.eval(() => {
            const editor = app.workspace.activeEditor!.editor!;
            return [editor.getValue(), editor.posToOffset(editor.getCursor())] as [string, number];
        });
        return { text, cursor, textWithCursor: text.slice(0, cursor) + CURSOR + text.slice(cursor) };
    }

    /**
     * Types text character by character using real key events (keydown/keypress/beforeinput), like a user would.
     * "\n" presses Enter, "\t" presses Tab.
     */
    async type(text: string, delayMs = 0) {
        for (const ch of text) {
            if (ch === "\n") await this.press("Enter");
            else if (ch === "\t") await this.press("Tab");
            else {
                const base = { key: ch, text: ch, modifiers: /[A-Z]/.test(ch) ? MODIFIER_BITS.Shift : 0 };
                await this.cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
                await this.cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
            }
            if (delayMs) await Bun.sleep(delayMs);
        }
    }

    /** Inserts text at once, like a paste or IME commit. */
    async insertText(text: string) {
        await this.cdp.send("Input.insertText", { text });
    }

    /**
     * Presses a key. `key` is a KeyboardEvent.key value ("Enter", "ArrowDown", "a", "D", " ", ...).
     * "Mod" is mapped to Ctrl/Meta depending on the platform.
     */
    async press(key: string, ...modifiers: (Modifier | "Mod")[]) {
        const mods = modifiers.map((m) => (m === "Mod" ? (process.platform === "darwin" ? "Meta" : "Ctrl") : m));
        const bits = mods.reduce((acc, m) => acc | MODIFIER_BITS[m], 0);
        const special = SPECIAL_KEYS[key];
        let code: string, keyCode: number, text: string | undefined;
        if (special) {
            ({ code, keyCode, text } = special);
        } else if (key.length === 1) {
            const upper = key.toUpperCase();
            code = /[A-Z]/.test(upper) ? "Key" + upper : /\d/.test(key) ? "Digit" + key : "";
            keyCode = upper.charCodeAt(0);
            text = key;
        } else {
            throw new Error("Unknown key: " + key);
        }
        // Keys combined with Ctrl/Alt/Meta don't produce text.
        if (mods.some((m) => m !== "Shift")) text = undefined;
        const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: bits };
        await this.cdp.send("Input.dispatchKeyEvent", {
            ...base,
            type: text ? "keyDown" : "rawKeyDown",
            text,
            unmodifiedText: text,
        });
        await this.cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    }

    // ---- Suggestion popup ---------------------------------------------------------------------------------------

    async popup(): Promise<PopupState> {
        return this.eval(() => {
            const container = Array.from(document.querySelectorAll(".suggestion-container")).find((c) =>
                c.querySelector(".completr-suggestion-item"),
            );
            if (!container || !container.isConnected) return { visible: false, items: [], selected: -1 };
            const items = Array.from(container.querySelectorAll(".suggestion-item"));
            return {
                visible: true,
                items: items.map((i) => (i.querySelector(".completr-suggestion-text") ?? i).textContent ?? ""),
                selected: items.findIndex((i) => i.classList.contains("is-selected")),
            };
        });
    }

    /** Waits until the popup is visible (and matches `predicate`, if given) and returns its state. */
    async waitForPopup(predicate: (p: PopupState) => boolean = () => true, timeout = 2_000): Promise<PopupState> {
        let last: PopupState | undefined;
        try {
            return await this.waitFor(
                async () => {
                    last = await this.popup();
                    return last.visible && predicate(last) ? last : null;
                },
                { timeout, what: "popup" },
            );
        } catch {
            throw new Error("Popup did not reach the expected state. Last state: " + JSON.stringify(last));
        }
    }

    /** Asserts that the popup stays closed for `ms` milliseconds (the suggest trigger is debounced by 50ms). */
    async expectNoPopup(ms = 250) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
            const p = await this.popup();
            if (p.visible) throw new Error("Expected no popup, but it is open with: " + JSON.stringify(p.items));
            await Bun.sleep(25);
        }
    }

    // ---- Plugin -------------------------------------------------------------------------------------------------

    private defaultSettings: Partial<CompletrSettings> = {};

    private async snapshotDefaultSettings() {
        this.defaultSettings = await this.eval(() => ({ ...app.plugins.plugins["obsidian-completr"]!.settings }));
    }

    /** Merges the given values into the plugin settings and saves them. */
    async setSettings(values: Partial<CompletrSettings>) {
        await this.eval(async (values: Partial<CompletrSettings>) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            Object.assign(plugin.settings, values);
            await plugin.saveSettings();
        }, values);
    }

    /** Restores the settings the plugin had right after the first launch. */
    async resetSettings() {
        await this.setSettings(this.defaultSettings);
    }

    /**
     * Runs one of Completr's commands like the command palette does. `id` is the id without the plugin prefix, e.g.
     * "completr-scan-vault". Throws if there is no such command.
     */
    async runCommand(id: string) {
        await this.eval((id: string) => {
            const commands = app.commands as unknown as {
                commands: Record<string, unknown>;
                executeCommandById(id: string): boolean;
            };
            if (!(id in commands.commands)) throw new Error("No such command: " + id);
            commands.executeCommandById(id);
        }, `${PLUGIN_ID}:${id}`);
    }

    /** Disables and re-enables the plugin (re-reads data.json and all data files). Resolves once it is loaded. */
    async reloadPlugin() {
        await this.eval(async (id: string) => {
            await app.plugins.disablePlugin(id);
            await app.plugins.enablePlugin(id);
            await app.plugins.plugins["obsidian-completr"]!.loaded;
        }, PLUGIN_ID);
    }

    /** Writes a file relative to the vault root through Obsidian's adapter (creates parent folders). */
    async writeVaultFile(path: string, content: string) {
        await this.eval(
            async (path: string, content: string) => {
                const adapter = app.vault.adapter;
                const parts = path.split("/");
                for (let i = 1; i < parts.length; i++) {
                    const dir = parts.slice(0, i).join("/");
                    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
                }
                await adapter.write(path, content);
            },
            path,
            content,
        );
    }

    async readVaultFile(path: string): Promise<string | null> {
        return this.eval(async (path: string) => {
            const adapter = app.vault.adapter;
            return (await adapter.exists(path)) ? await adapter.read(path) : null;
        }, path);
    }

    async screenshot(path: string) {
        const { data } = await this.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        await Bun.write(path, Buffer.from(data, "base64"));
    }
}

let instance: Promise<Obsidian> | null = null;

/** Returns the shared Obsidian instance for this test run, launching it on first use. */
export function getObsidian(): Promise<Obsidian> {
    instance ??= Obsidian.launch();
    return instance;
}

export async function shutdownObsidian() {
    if (!instance) return;
    const o = await instance.catch(() => null);
    instance = null;
    await o?.shutdown();
}
