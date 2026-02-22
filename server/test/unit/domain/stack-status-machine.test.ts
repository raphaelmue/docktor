import {describe, expect, it} from "vitest";
import {
    assertTransition,
    canTransition,
    TransitionError,
    TRANSITIONS,
    ACTION_TARGET,
    type Action,
} from "../../../src/domain/stack-status-machine.js";
import type {StackStatus} from "../../../src/generated/prisma/enums.js";

const ALL_STATUSES: StackStatus[] = [
    "DRAFT",
    "DEPLOYING",
    "RUNNING",
    "HEALTHY",
    "UNHEALTHY",
    "STOPPED",
    "ERROR",
    "UPDATING",
    "BACKING_UP",
    "RESTORING",
];

const ALL_ACTIONS: Action[] = [
    "DEPLOY",
    "STOP",
    "RESTART",
    "DELETE",
    "UPDATE",
    "BACKUP",
    "RESTORE",
];

describe("canTransition", () => {
    it.each(ALL_ACTIONS)("returns true for all valid source statuses of %s", (action) => {
        for (const status of TRANSITIONS[action]) {
            expect(canTransition(status, action)).toBe(true);
        }
    });

    it("returns false for invalid transitions", () => {
        expect(canTransition("DEPLOYING", "DEPLOY")).toBe(false);
        expect(canTransition("DEPLOYING", "DELETE")).toBe(false);
        expect(canTransition("RUNNING", "DELETE")).toBe(false);
    });

    it("DEPLOY is allowed from DRAFT, STOPPED, ERROR, RUNNING, HEALTHY, UNHEALTHY", () => {
        expect(canTransition("DRAFT", "DEPLOY")).toBe(true);
        expect(canTransition("STOPPED", "DEPLOY")).toBe(true);
        expect(canTransition("ERROR", "DEPLOY")).toBe(true);
        expect(canTransition("RUNNING", "DEPLOY")).toBe(true);
        expect(canTransition("HEALTHY", "DEPLOY")).toBe(true);
        expect(canTransition("UNHEALTHY", "DEPLOY")).toBe(true);
    });

    it("STOP is allowed from RUNNING, HEALTHY, UNHEALTHY, ERROR", () => {
        expect(canTransition("RUNNING", "STOP")).toBe(true);
        expect(canTransition("HEALTHY", "STOP")).toBe(true);
        expect(canTransition("UNHEALTHY", "STOP")).toBe(true);
        expect(canTransition("ERROR", "STOP")).toBe(true);
        expect(canTransition("DRAFT", "STOP")).toBe(false);
    });

    it("RESTART is allowed from RUNNING, HEALTHY, UNHEALTHY only", () => {
        expect(canTransition("RUNNING", "RESTART")).toBe(true);
        expect(canTransition("HEALTHY", "RESTART")).toBe(true);
        expect(canTransition("UNHEALTHY", "RESTART")).toBe(true);
        expect(canTransition("STOPPED", "RESTART")).toBe(false);
    });

    it("DELETE is allowed from DRAFT, STOPPED, ERROR only", () => {
        expect(canTransition("DRAFT", "DELETE")).toBe(true);
        expect(canTransition("STOPPED", "DELETE")).toBe(true);
        expect(canTransition("ERROR", "DELETE")).toBe(true);
        expect(canTransition("RUNNING", "DELETE")).toBe(false);
    });
});

describe("assertTransition", () => {
    it("does not throw for valid transitions", () => {
        expect(() => assertTransition("DRAFT", "DEPLOY")).not.toThrow();
        expect(() => assertTransition("RUNNING", "STOP")).not.toThrow();
        expect(() => assertTransition("STOPPED", "DELETE")).not.toThrow();
    });

    it("throws TransitionError for invalid transitions", () => {
        expect(() => assertTransition("RUNNING", "DELETE")).toThrow(TransitionError);
    });

    it("TransitionError has correct fields", () => {
        try {
            assertTransition("RUNNING", "DELETE");
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(TransitionError);
            const te = err as TransitionError;
            expect(te.currentStatus).toBe("RUNNING");
            expect(te.action).toBe("DELETE");
            expect(te.allowedFrom).toEqual(TRANSITIONS.DELETE);
            expect(te.message).toContain("RUNNING");
            expect(te.message).toContain("DELETE");
        }
    });
});

describe("ACTION_TARGET", () => {
    it("maps each action to its target status", () => {
        expect(ACTION_TARGET.DEPLOY).toBe("DEPLOYING");
        expect(ACTION_TARGET.STOP).toBe("STOPPED");
        expect(ACTION_TARGET.RESTART).toBe("RUNNING");
        expect(ACTION_TARGET.DELETE).toBe("STOPPED");
        expect(ACTION_TARGET.UPDATE).toBe("UPDATING");
        expect(ACTION_TARGET.BACKUP).toBe("BACKING_UP");
        expect(ACTION_TARGET.RESTORE).toBe("RESTORING");
    });
});
