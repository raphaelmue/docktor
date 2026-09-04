import "@testing-library/jest-dom/vitest";
import {afterEach, vi} from "vitest";
import {cleanup} from "@testing-library/react";

// Ensure React Testing Library cleanup runs after each test
afterEach(() => {
    cleanup();
});

// jsdom does not provide EventSource — provide a minimal stub so component tests
// that render components using useLogStream / useContainerEvents don't throw.
// Individual hook tests that need to assert EventSource behaviour set their own
// more complete mock in beforeEach and clean up in afterEach.
if (typeof globalThis.EventSource === "undefined") {
    const MockEventSource = vi.fn(function (this: any, _url: string) {
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.close = vi.fn();
        this.readyState = 0;
    }) as any;
    MockEventSource.CONNECTING = 0;
    MockEventSource.OPEN = 1;
    MockEventSource.CLOSED = 2;
    globalThis.EventSource = MockEventSource;
}
