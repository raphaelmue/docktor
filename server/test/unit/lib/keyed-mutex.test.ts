import {describe, expect, it} from "vitest";
import {withKeyedLock} from "../../../src/lib/keyed-mutex.js";

describe("withKeyedLock", () => {
    it("runs fn and resolves with its result", async () => {
        const result = await withKeyedLock("key-1", async () => "hello");
        expect(result).toBe("hello");
    });

    it("serializes two calls with the same key so the second starts only after the first settles — proven by marker ordering, not timing", async () => {
        const events: string[] = [];
        let resolveFirst!: () => void;
        const gate = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });

        const first = withKeyedLock("stack-1", async () => {
            events.push("first-start");
            await gate;
            events.push("first-end");
        });

        const second = withKeyedLock("stack-1", async () => {
            events.push("second-start");
        });

        // Give the microtask queue a few turns — enough for "first-start" to
        // run, but the gate is still held, so "second-start" must not have
        // happened yet.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(events).toEqual(["first-start"]);

        resolveFirst();
        await Promise.all([first, second]);

        expect(events).toEqual(["first-start", "first-end", "second-start"]);
    });

    it("allows calls with different keys to overlap", async () => {
        const events: string[] = [];
        let resolveA!: () => void;
        const gateA = new Promise<void>((resolve) => {
            resolveA = resolve;
        });

        const a = withKeyedLock("stack-a", async () => {
            events.push("a-start");
            await gateA;
            events.push("a-end");
            return "a-done";
        });

        const b = withKeyedLock("stack-b", async () => {
            events.push("b-start");
            return "b-done";
        });

        // If different keys shared a lock, this await would hang until
        // resolveA() is called (never, at this point) and the test would
        // time out — proving overlap by construction, not by timing.
        await expect(b).resolves.toBe("b-done");
        expect(events).toContain("b-start");
        expect(events).not.toContain("a-end");

        resolveA();
        await expect(a).resolves.toBe("a-done");
        expect(events).toEqual(["a-start", "b-start", "a-end"]);
    });

    it("propagates a rejecting fn's error to its own caller, and still releases the lock so a later same-key call runs", async () => {
        const boom = new Error("boom");

        await expect(
            withKeyedLock("stack-1", async () => {
                throw boom;
            }),
        ).rejects.toBe(boom);

        const result = await withKeyedLock("stack-1", async () => "after-rejection");
        expect(result).toBe("after-rejection");
    });

    it("does not let one key's queue block a later call on the same key once every prior call has settled", async () => {
        const order: number[] = [];
        for (let i = 0; i < 5; i++) {
            // eslint-disable-next-line no-await-in-loop
            await withKeyedLock("stack-sequential", async () => {
                order.push(i);
            });
        }
        expect(order).toEqual([0, 1, 2, 3, 4]);
    });
});
