import { Notice } from "obsidian";

/** Shows an unexpected error to the user and logs it. */
export function reportError(error: unknown) {
    console.error("Completr:", error);
    new Notice("Completr: " + (error instanceof Error ? error.message : String(error)), 8000);
}

/**
 * Wraps the handler of a button or command that does something asynchronous: errors are shown instead of ending up as
 * unhandled rejections, and it can't be started again while it is still running (e.g. by a double click).
 */
export function guarded<Args extends unknown[]>(action: (...args: Args) => unknown): (...args: Args) => Promise<void> {
    let running = false;
    return async (...args) => {
        if (running) return;
        running = true;
        try {
            await action(...args);
        } catch (e) {
            reportError(e);
        } finally {
            running = false;
        }
    };
}
