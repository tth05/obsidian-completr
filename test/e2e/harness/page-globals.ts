/**
 * Globals available to functions passed to `Obsidian.eval`, which run inside the Obsidian window.
 */
import type { App, Plugin } from "obsidian";
import type CompletrPlugin from "../../../src/main.ts";

interface PluginManager {
    plugins: Record<string, Plugin | undefined> & { "obsidian-completr"?: CompletrPlugin & { _loaded: boolean } };
    enabledPlugins: Set<string>;
    setEnable(enabled: boolean): Promise<void>;
    enablePlugin(id: string): Promise<boolean>;
    disablePlugin(id: string): Promise<void>;
}

export type TestApp = App & { appId: string; plugins: PluginManager };

declare global {
    var app: TestApp;
}
