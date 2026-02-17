import type {
    Stack,
    Service,
    CreateStackInput,
    UpdateStackInput,
} from "@docktor/shared";
import {apiFetch} from "./api";

export interface StackWithServices extends Stack {
    services: Service[];
}

export interface StackDetail extends StackWithServices {
    deployments: {
        id: string;
        composeHash: string;
        deployedAt: string;
        success: boolean;
        errorMessage: string | null;
    }[];
    statusLogs: {
        id: string;
        fromStatus: string | null;
        toStatus: string;
        message: string | null;
        createdAt: string;
    }[];
}

export function listStacks() {
    return apiFetch<StackWithServices[]>("/api/stacks");
}

export function getStack(id: string) {
    return apiFetch<StackDetail>(`/api/stacks/${id}`);
}

export function createStack(input: CreateStackInput) {
    return apiFetch<StackWithServices>("/api/stacks", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export function updateStack(id: string, input: UpdateStackInput) {
    return apiFetch<StackDetail>(`/api/stacks/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
}

export function deleteStack(id: string) {
    return apiFetch<void>(`/api/stacks/${id}`, {method: "DELETE"});
}

export function deployStack(id: string) {
    return apiFetch<{success: boolean; errorMessage?: string}>(
        `/api/stacks/${id}/deploy`,
        {method: "POST"},
    );
}

export function stopStack(id: string) {
    return apiFetch<{success: boolean}>(`/api/stacks/${id}/stop`, {
        method: "POST",
    });
}

export function restartStack(id: string) {
    return apiFetch<{success: boolean}>(`/api/stacks/${id}/restart`, {
        method: "POST",
    });
}

export function getComposeContent(id: string) {
    return apiFetch<{content: string}>(`/api/stacks/${id}/compose`);
}

export function getEnvContent(id: string) {
    return apiFetch<{content: string}>(`/api/stacks/${id}/env`);
}
