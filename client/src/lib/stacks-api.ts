import type {CreateStackInput, UpdateStackInput} from "@docktor/shared";
import {apiFetch} from "./api";

export interface Stack {
    id: string;
    displayName: string;
    description: string | null;
    hostPath: string;
    status: string;
    configChanged: boolean;
    lastKnownHash: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface Service {
    id: string;
    stackId: string;
    serviceName: string;
    image: string;
    imageTag: string | null;
    ports: string | null;
    volumes: string | null;
    containerId: string | null;
    containerState: string | null;
    healthStatus: string | null;
    updateAvailable?: boolean;
    latestTag?: string | null;
    createdAt: string;
    updatedAt: string;
}

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

export function updateImages(id: string) {
    return apiFetch<{success: boolean; noUpdates: boolean}>(`/api/stacks/${id}/update`, {
        method: "POST",
    });
}

export interface ServiceTagsResponse {
    currentTag: string;
    latestTag: string | null;
    candidates: string[];
}

export interface UpgradeServiceResponse {
    success: boolean;
    changed: boolean;
    previousTag: string | null;
    newTag: string;
}

export function getServiceTags(stackId: string, serviceName: string) {
    return apiFetch<ServiceTagsResponse>(
        `/api/stacks/${encodeURIComponent(stackId)}/services/${encodeURIComponent(serviceName)}/tags`,
    );
}

export function upgradeService(stackId: string, serviceName: string, targetTag: string) {
    return apiFetch<UpgradeServiceResponse>(
        `/api/stacks/${encodeURIComponent(stackId)}/services/${encodeURIComponent(serviceName)}/upgrade`,
        {
            method: "POST",
            body: JSON.stringify({targetTag}),
        },
    );
}
