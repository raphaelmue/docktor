import {parse as parseYaml} from "yaml";

// Matches a whole-value shell-style variable reference: "${VAR}" or "$VAR",
// optionally with a default ("${VAR:-default}"). A value that IS one of these
// is a pass-through from the host/.env, not a hardcoded inline literal.
const VARIABLE_REFERENCE_PATTERN = /^\$(\{[A-Za-z_][A-Za-z0-9_]*(:?[-?+][^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)$/;

function isVariableReference(value: string): boolean {
    return VARIABLE_REFERENCE_PATTERN.test(value.trim());
}

export type CompatibilityLevel = "green" | "yellow" | "red";

export interface BindMountInfo {
    path: string;
    type: "relative" | "absolute";
    serviceName: string;
    containerPath: string;
}

export interface AnalysisResult {
    compatibility: CompatibilityLevel;
    namedVolumes: string[];
    bindMounts: BindMountInfo[];
    inlineEnvVars: {serviceName: string; vars: Record<string, string>}[];
    unsupportedFeatures: string[];
    serviceCount: number;
}

export class ComposeAnalyzer {
    analyzeCompatibility(content: string): AnalysisResult {
        const doc = parseYaml(content);

        const namedVolumes = this.extractNamedVolumes(doc);
        const bindMounts = this.extractBindMounts(doc);
        const inlineEnvVars = this.extractInlineEnvVars(doc);
        const unsupportedFeatures = this.detectUnsupportedFeatures(doc);
        const serviceCount = Object.keys(doc?.services || {}).length;

        let compatibility: CompatibilityLevel = "green";

        // Red: unsupported features (configs, secrets, depends_on conditions)
        if (unsupportedFeatures.length > 0) {
            compatibility = "red";
        }
        // Yellow: named volumes, absolute paths, or inline env vars
        else if (
            namedVolumes.length > 0 ||
            bindMounts.some((m) => m.type === "absolute") ||
            inlineEnvVars.length > 0
        ) {
            compatibility = "yellow";
        }

        return {
            compatibility,
            namedVolumes,
            bindMounts,
            inlineEnvVars,
            unsupportedFeatures,
            serviceCount,
        };
    }

    extractNamedVolumes(doc: any): string[] {
        if (!doc?.volumes || typeof doc.volumes !== "object") return [];
        return Object.keys(doc.volumes);
    }

    extractBindMounts(doc: any): BindMountInfo[] {
        const results: BindMountInfo[] = [];
        const services = doc?.services || {};

        for (const [serviceName, service] of Object.entries(services)) {
            const svc = service as any;
            if (!Array.isArray(svc?.volumes)) continue;

            for (const vol of svc.volumes) {
                const mount = this.parseVolumeEntry(vol, serviceName);
                if (mount) results.push(mount);
            }
        }

        return results;
    }

    /**
     * Parses a single volumes[] entry, in either short form ("host:container")
     * or long form ({type, source, target}). Returns null for entries that
     * aren't host bind mounts (named-volume references in either form).
     */
    private parseVolumeEntry(vol: unknown, serviceName: string): BindMountInfo | null {
        if (typeof vol === "string") {
            if (!vol.includes(":")) return null;
            const [hostPath, containerPath] = vol.split(":");
            // Skip named volume references (no / or . prefix)
            if (!hostPath.startsWith(".") && !hostPath.startsWith("/")) return null;
            return {
                path: hostPath,
                type: hostPath.startsWith("/") ? "absolute" : "relative",
                serviceName,
                containerPath,
            };
        }

        if (vol && typeof vol === "object") {
            const v = vol as any;
            if (v.type !== "bind" || typeof v.source !== "string") return null;
            return {
                path: v.source,
                type: v.source.startsWith("/") ? "absolute" : "relative",
                serviceName,
                containerPath: typeof v.target === "string" ? v.target : "",
            };
        }

        return null;
    }

    extractInlineEnvVars(doc: any): {serviceName: string; vars: Record<string, string>}[] {
        const results: {serviceName: string; vars: Record<string, string>}[] = [];
        const services = doc?.services || {};

        for (const [serviceName, service] of Object.entries(services)) {
            const svc = service as any;
            const env = svc?.environment;

            // Array form (${VAR} references) is NOT inline
            if (Array.isArray(env)) continue;

            // Object form is inline, except when a value is itself a variable
            // reference (${VAR} or $VAR) rather than a literal — that's a
            // pass-through from the host/.env, not a hardcoded inline value.
            if (env && typeof env === "object") {
                const vars: Record<string, string> = {};
                for (const [key, value] of Object.entries(env)) {
                    const strValue = String(value);
                    if (isVariableReference(strValue)) continue;
                    vars[key] = strValue;
                }
                if (Object.keys(vars).length > 0) {
                    results.push({serviceName, vars});
                }
            }
        }

        return results;
    }

    private detectUnsupportedFeatures(doc: any): string[] {
        const features: string[] = [];

        if (doc?.configs) features.push("configs");
        if (doc?.secrets) features.push("secrets");

        const services = doc?.services || {};
        for (const [serviceName, service] of Object.entries(services)) {
            const svc = service as any;
            const deps = svc?.depends_on;

            // Object form with conditions is unsupported
            if (deps && typeof deps === "object" && !Array.isArray(deps)) {
                for (const [depName, depConfig] of Object.entries(deps)) {
                    if (typeof depConfig === "object" && (depConfig as any)?.condition) {
                        features.push(`depends_on condition (${serviceName} -> ${depName})`);
                    }
                }
            }
        }

        return features;
    }
}

export const composeAnalyzer = new ComposeAnalyzer();
