import {parse as parseYaml} from "yaml";
import {createHash} from "node:crypto";

export interface ParsedService {
    serviceName: string;
    image: string;
    imageTag: string | null;
    ports: {host: number; container: number; protocol: string}[];
    volumes: {hostPath: string; containerPath: string}[];
}

export function parseComposeContent(content: string): ParsedService[] {
    const doc = parseYaml(content);
    const services: ParsedService[] = [];

    const svcMap = doc?.services;
    if (!svcMap || typeof svcMap !== "object") {
        return services;
    }

    for (const [name, def] of Object.entries(svcMap) as [string, any][]) {
        if (!def || typeof def !== "object") continue;

        const rawImage: string = def.image ?? "";
        let image = rawImage;
        let imageTag: string | null = null;

        if (rawImage.includes(":")) {
            const lastColon = rawImage.lastIndexOf(":");
            image = rawImage.slice(0, lastColon);
            imageTag = rawImage.slice(lastColon + 1);
        }

        const ports: ParsedService["ports"] = [];
        if (Array.isArray(def.ports)) {
            for (const p of def.ports) {
                const str = String(p);
                const match = str.match(/^(\d+):(\d+)(?:\/(tcp|udp))?$/);
                if (match) {
                    ports.push({
                        host: parseInt(match[1], 10),
                        container: parseInt(match[2], 10),
                        protocol: match[3] ?? "tcp",
                    });
                }
            }
        }

        const volumes: ParsedService["volumes"] = [];
        if (Array.isArray(def.volumes)) {
            for (const v of def.volumes) {
                if (typeof v === "string" && v.includes(":")) {
                    const [hostPath, containerPath] = v.split(":");
                    volumes.push({hostPath, containerPath});
                }
            }
        }

        services.push({serviceName: name, image, imageTag, ports, volumes});
    }

    return services;
}

export function hashComposeContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}
