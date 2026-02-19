import type {StackStatus} from "../generated/prisma/enums.js";

export type Action =
    | "DEPLOY"
    | "STOP"
    | "RESTART"
    | "DELETE"
    | "UPDATE"
    | "BACKUP"
    | "RESTORE";

export const TRANSITIONS: Record<Action, readonly StackStatus[]> = {
    DEPLOY: ["DRAFT", "STOPPED", "ERROR", "RUNNING", "HEALTHY", "UNHEALTHY"],
    STOP: ["RUNNING", "HEALTHY", "UNHEALTHY", "ERROR"],
    RESTART: ["RUNNING", "HEALTHY", "UNHEALTHY"],
    DELETE: ["DRAFT", "STOPPED", "ERROR"],
    UPDATE: ["DRAFT", "STOPPED", "ERROR", "RUNNING", "HEALTHY", "UNHEALTHY"],
    BACKUP: ["RUNNING", "HEALTHY", "UNHEALTHY", "STOPPED"],
    RESTORE: ["STOPPED", "ERROR"],
} as const;

export const ACTION_TARGET: Record<Action, StackStatus> = {
    DEPLOY: "DEPLOYING",
    STOP: "STOPPED",
    RESTART: "RUNNING",
    DELETE: "STOPPED",
    UPDATE: "UPDATING",
    BACKUP: "BACKING_UP",
    RESTORE: "RESTORING",
} as const;

export class TransitionError extends Error {
    constructor(
        public readonly currentStatus: StackStatus,
        public readonly action: Action,
        public readonly allowedFrom: readonly StackStatus[],
    ) {
        super(
            `Cannot "${action}" stack in "${currentStatus}" status. Allowed from: ${allowedFrom.join(", ")}`,
        );
        this.name = "TransitionError";
    }
}

export function canTransition(current: StackStatus, action: Action): boolean {
    return TRANSITIONS[action].includes(current);
}

export function assertTransition(current: StackStatus, action: Action): void {
    if (!canTransition(current, action)) {
        throw new TransitionError(current, action, TRANSITIONS[action]);
    }
}
