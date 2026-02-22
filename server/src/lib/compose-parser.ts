import {parse as parseYaml} from "yaml";
import {createHash} from "node:crypto";

export interface ParsedService {
    serviceName: string;
    image: string;
    imageTag: string | null;
    ports: {host: number; container: number; protocol: string}[];
    volumes: {hostPath: string; containerPath: string}[];
}

const PORT_PATTERN = /^(\d+):(\d+)(?:\/(tcp|udp))?$/;

function parseImage(rawImage: string): {image: string; imageTag: string | null} {
    if (!rawImage.includes(":")) {
        return {image: rawImage, imageTag: null};
    }
    const lastColon = rawImage.lastIndexOf(":");
    return {
        image: rawImage.slice(0, lastColon),
        imageTag: rawImage.slice(lastColon + 1),
    };
}

function parsePorts(rawPorts: unknown): ParsedService["ports"] {
    if (!Array.isArray(rawPorts)) return [];

    return rawPorts.flatMap((p) => {
        const match = PORT_PATTERN.exec(String(p));
        if (!match) return [];
        return [{
            host: Number.parseInt(match[1], 10),
            container: Number.parseInt(match[2], 10),
            protocol: match[3] ?? "tcp",
        }];
    });
}

function parseVolumes(rawVolumes: unknown): ParsedService["volumes"] {
    if (!Array.isArray(rawVolumes)) return [];

    return rawVolumes.flatMap((v) => {
        if (typeof v !== "string" || !v.includes(":")) return [];
        const [hostPath, containerPath] = v.split(":");
        return [{hostPath, containerPath}];
    });
}

export function parseComposeContent(content: string): ParsedService[] {
    const doc = parseYaml(content);
    const svcMap = doc?.services;
    if (!svcMap || typeof svcMap !== "object") {
        return [];
    }

    return Object.entries(svcMap as Record<string, Record<string, unknown>>)
        .filter(([, def]) => def && typeof def === "object")
        .map(([name, def]) => ({
            serviceName: name,
            ...parseImage(String(def.image ?? "")),
            ports: parsePorts(def.ports),
            volumes: parseVolumes(def.volumes),
        }));
}

export function hashComposeContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}
