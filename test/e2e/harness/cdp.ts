/**
 * Minimal Chrome DevTools Protocol client, enough to drive an Obsidian (Electron) window.
 */
export class CdpClient {
    private nextId = 0;
    private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    private constructor(private readonly ws: WebSocket) {
        ws.addEventListener("message", (e) => {
            const msg = JSON.parse(e.data as string) as { id?: number; result?: unknown; error?: { message: string } };
            if (msg.id === undefined) return;
            const p = this.pending.get(msg.id);
            if (!p) return;
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
        });
        ws.addEventListener("close", () => {
            for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
            this.pending.clear();
        });
    }

    static async connect(url: string): Promise<CdpClient> {
        const ws = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve(), { once: true });
            ws.addEventListener("error", () => reject(new Error("Failed to connect to " + url)), { once: true });
        });
        return new CdpClient(ws);
    }

    send<T = unknown>(method: string, params: object = {}): Promise<T> {
        const id = ++this.nextId;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    /**
     * Evaluates an expression in the page. Promises are awaited, the result is returned by value (must be JSON
     * serializable). Page exceptions are rethrown here.
     */
    async evaluate<T = unknown>(expression: string): Promise<T> {
        const res = await this.send<{
            result: { value?: T };
            exceptionDetails?: { text: string; exception?: { description?: string } };
        }>("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        });
        if (res.exceptionDetails) {
            throw new Error(
                "Page exception: " + (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text),
            );
        }
        return res.result.value as T;
    }

    close() {
        this.ws.close();
    }
}
