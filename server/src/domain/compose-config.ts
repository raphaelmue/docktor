import {hashComposeContent, parseComposeContent, type ParsedService,} from "../lib/compose-parser.js";

export type {ParsedService};

export interface ComposeConfig {
    readonly hash: string;
    readonly services: readonly ParsedService[];
}

export function createComposeConfig(content: string): ComposeConfig {
    return {
        hash: hashComposeContent(content),
        services: parseComposeContent(content),
    };
}
