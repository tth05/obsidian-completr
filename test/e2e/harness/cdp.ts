/**
 * Minimal Chrome DevTools Protocol client, enough to drive an Obsidian (Electron) window.
 */
export class CdpClient {
    private nextId = 0;
    private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private readonly listeners = new Map<string, Set<(params: unknown) => void>>();

    private constructor(private readonly ws: WebSocket) {
        ws.addEventListener("message", (e) => {
            const msg = JSON.parse(e.data as string) as {
                id?: number;
                method?: string;
                params?: unknown;
                result?: unknown;
                error?: { message: string };
            };
            if (msg.id === undefined) {
                if (msg.method) for (const listener of this.listeners.get(msg.method) ?? []) listener(msg.params);
                return;
            }
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

    /** Subscribes to a CDP event (the domain must be enabled). Returns a function that unsubscribes. */
    on<T = unknown>(method: string, listener: (params: T) => void): () => void {
        let set = this.listeners.get(method);
        if (!set) this.listeners.set(method, (set = new Set()));
        const l = listener as (params: unknown) => void;
        set.add(l);
        return () => set.delete(l);
    }

    /** Resolves with the params of the next event of the given type. */
    waitForEvent<T = unknown>(method: string, timeoutMs = 2_000): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                off();
                reject(new Error(`Timed out waiting for ${method}`));
            }, timeoutMs);
            const off = this.on<T>(method, (params) => {
                clearTimeout(timer);
                off();
                resolve(params);
            });
        });
    }

    close() {
        this.ws.close();
    }
}
