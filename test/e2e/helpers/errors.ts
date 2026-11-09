/**
 * Collects errors inside Obsidian (console.error, uncaught exceptions, unhandled rejections).
 */
import type { Obsidian } from "../harness/obsidian.ts";

/** Starts collecting errors (idempotent) and clears the ones collected so far. */
export async function startErrorCapture(obsidian: Obsidian) {
    await obsidian.eval(() => {
        const w = window as unknown as { __e2eErrors?: string[] };
        if (!w.__e2eErrors) {
            const errors: string[] = [];
            const format = (v: unknown) => (v instanceof Error ? (v.stack ?? v.message) : String(v));
            const original = console.error.bind(console);
            console.error = (...args: unknown[]) => {
                errors.push(args.map(format).join(" "));
                original(...args);
            };
            window.addEventListener("error", (e) => errors.push(format(e.error ?? e.message)));
            window.addEventListener("unhandledrejection", (e) => errors.push(format(e.reason)));
            w.__e2eErrors = errors;
        }
        w.__e2eErrors.length = 0;
    });
}

/** Returns the errors collected since {@link startErrorCapture}, and clears them. */
export function takeErrors(obsidian: Obsidian): Promise<string[]> {
    return obsidian.eval(() => {
        const errors = (window as unknown as { __e2eErrors?: string[] }).__e2eErrors ?? [];
        return errors.splice(0, errors.length);
    });
}
