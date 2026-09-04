import {apiFetch} from "@/lib/api"

export interface ProxyConfig {
    id: string
    stackId: string
    serviceName: string
    domain: string
    internalPort: number
    tlsEnabled: boolean
    certStatus: string
    certMessage: string | null
    certCheckedAt: string | null
    createdAt: string
    updatedAt: string
}

export interface AssignDomainInput {
    domain: string
    internalPort: number
    tlsEnabled: boolean
}

export interface ProxyState {
    deployed: boolean
    status: string | null
    acmeEmail: string
    showInDashboard: boolean
}

export async function getProxyConfigs(stackId: string): Promise<ProxyConfig[]> {
    return apiFetch<ProxyConfig[]>(`/api/stacks/${stackId}/proxy-configs`)
}

export async function assignDomain(
    stackId: string,
    serviceName: string,
    data: AssignDomainInput,
): Promise<ProxyConfig> {
    return apiFetch<ProxyConfig>(
        `/api/stacks/${stackId}/services/${serviceName}/proxy`,
        {
            method: "POST",
            body: JSON.stringify(data),
        },
    )
}

export async function removeDomain(proxyConfigId: string): Promise<void> {
    await apiFetch(`/api/proxy-configs/${proxyConfigId}`, {method: "DELETE"})
}

export async function getProxySettings(): Promise<ProxyState> {
    return apiFetch<ProxyState>("/api/settings/proxy")
}

export async function saveProxySettings(
    data: Pick<ProxyState, "acmeEmail" | "showInDashboard">,
): Promise<void> {
    await apiFetch("/api/settings/proxy", {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

export async function deployProxyStack(): Promise<ProxyState> {
    return apiFetch<ProxyState>("/api/settings/proxy/deploy", {method: "POST"})
}
