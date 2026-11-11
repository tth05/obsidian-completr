/**
 * Helpers for the Callout Manager plugin. It is installed as a pinned, hash-verified release, see
 * {@link CALLOUT_MANAGER} in third_party_plugins.ts.
 */
import type { Obsidian } from "../harness/obsidian.ts";
import { CALLOUT_MANAGER } from "./third_party_plugins.ts";

interface CalloutManagerPlugin {
    createCustomCallout(id: string): void;
    removeCustomCallout(id: string): void;
}

/** Adds a custom callout through Callout Manager, like its settings UI does. */
export async function addCustomCallout(obsidian: Obsidian, id: string) {
    await obsidian.eval(
        (pluginId: string, id: string) =>
            (app.plugins.plugins[pluginId] as unknown as CalloutManagerPlugin).createCustomCallout(id),
        CALLOUT_MANAGER.id,
        id,
    );
}

/** Removes a custom callout. Does nothing if Callout Manager isn't loaded. */
export async function removeCustomCallout(obsidian: Obsidian, id: string) {
    await obsidian.eval(
        (pluginId: string, id: string) =>
            (app.plugins.plugins[pluginId] as unknown as CalloutManagerPlugin | undefined)?.removeCustomCallout(id),
        CALLOUT_MANAGER.id,
        id,
    );
}
