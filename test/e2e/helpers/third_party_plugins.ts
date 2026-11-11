/**
 * Installs other community plugins into the test vault, for compatibility tests. Only exact, pinned releases are
 * used: every file is checked against a hardcoded SHA-256 before it is used, so the tests never run code that wasn't
 * reviewed when pinning. To update a plugin, download the new release, review it, and update version and hashes here.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Obsidian } from "../harness/obsidian.ts";

export interface PinnedPlugin {
    id: string;
    repo: string;
    /** Release tag. */
    version: string;
    /** File name -> SHA-256 (hex). */
    files: Record<string, string>;
}

export const CALLOUT_MANAGER: PinnedPlugin = {
    id: "callout-manager",
    repo: "eth-p/obsidian-callout-manager",
    version: "1.1.2",
    files: {
        "main.js": "3c97eba0dd0c7e78bf3faad701cbbc3834754264bcf0717af64403fe152b2f04",
        "manifest.json": "b0e02242c78b39e1263da891d789e3fcaa0c1f6c48aa1c2bbe4b892ddc8cce0a",
        "styles.css": "85dd7d013ad642fcf6cc9fbd87a81ad70769276c4725722562e3585f4407aa54",
    },
};

export const LATEX_SUITE: PinnedPlugin = {
    id: "obsidian-latex-suite",
    repo: "artisticat1/obsidian-latex-suite",
    version: "1.14.3",
    files: {
        "main.js": "14a296ff6e2eb1e06522c5503436eba7cd5e7ad325ee329fd3c3ae5d159add94",
        "manifest.json": "f16310e6f4ca48ddbf212d41e69fb501716a725044187a967b26d150d30a13ed",
        "styles.css": "a2e2ef4dea479e9c2377f0a9883fe539fc2b129b244863424309f8f92c1dc814",
    },
};

function sha256(data: Uint8Array): string {
    return createHash("sha256").update(data).digest("hex");
}

function cacheDir(plugin: PinnedPlugin): string {
    return join(process.env.E2E_CACHE_DIR ?? join(tmpdir(), "completr-e2e-cache"), `${plugin.id}-${plugin.version}`);
}

/**
 * Returns the verified contents of a pinned plugin's file, downloading it if it isn't cached yet. Throws if the hash
 * doesn't match, also for cached files (which might have been tampered with).
 */
async function getVerifiedFile(plugin: PinnedPlugin, file: string): Promise<Uint8Array> {
    const expected = plugin.files[file];
    const path = join(cacheDir(plugin), file);
    if (existsSync(path)) {
        const data = readFileSync(path);
        if (sha256(data) === expected) return data;
    }

    const url = `https://github.com/${plugin.repo}/releases/download/${plugin.version}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Unable to download ${url}: ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    const actual = sha256(data);
    if (actual !== expected)
        throw new Error(`Hash mismatch for ${url}: expected ${expected}, got ${actual}. Refusing to use it.`);

    mkdirSync(cacheDir(plugin), { recursive: true });
    // Write to a temp name first, so an interrupted write doesn't leave a broken file behind
    writeFileSync(path + ".tmp", data);
    renameSync(path + ".tmp", path);
    return data;
}

/** Copies the verified plugin into the test vault and enables it. */
export async function installPinnedPlugin(obsidian: Obsidian, plugin: PinnedPlugin) {
    const target = join(obsidian.vaultDir, ".obsidian", "plugins", plugin.id);
    mkdirSync(target, { recursive: true });
    for (const file of Object.keys(plugin.files))
        writeFileSync(join(target, file), await getVerifiedFile(plugin, file));

    await obsidian.eval(async (id: string) => {
        const plugins = app.plugins as unknown as {
            loadManifests(): Promise<void>;
            enablePluginAndSave(id: string): Promise<boolean>;
        };
        await plugins.loadManifests();
        await plugins.enablePluginAndSave(id);
    }, plugin.id);
    await obsidian.waitFor(
        () =>
            obsidian.eval(
                (id: string) => !!(app.plugins.plugins[id] as { _loaded?: boolean } | undefined)?._loaded,
                plugin.id,
            ),
        { timeout: 10_000, what: `${plugin.id} to load` },
    );
}

export async function disablePinnedPlugin(obsidian: Obsidian, plugin: PinnedPlugin) {
    await obsidian.eval(async (id: string) => {
        if (app.plugins.enabledPlugins.has(id) || app.plugins.plugins[id])
            await (app.plugins as unknown as { disablePluginAndSave(id: string): Promise<void> }).disablePluginAndSave(
                id,
            );
    }, plugin.id);
}
