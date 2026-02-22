import {describe, expect, it} from "vitest";
import {hashComposeContent, parseComposeContent} from "../../../src/lib/compose-parser.js";

describe("parseComposeContent", () => {
    it("parses services with image, ports, and volumes", () => {
        const content = `
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html
`;
        const services = parseComposeContent(content);

        expect(services).toHaveLength(1);
        expect(services[0].serviceName).toBe("web");
        expect(services[0].image).toBe("nginx");
        expect(services[0].imageTag).toBe("latest");
        expect(services[0].ports).toEqual([{host: 8080, container: 80, protocol: "tcp"}]);
        expect(services[0].volumes).toEqual([{hostPath: "./html", containerPath: "/usr/share/nginx/html"}]);
    });

    it("handles image without tag", () => {
        const services = parseComposeContent("services:\n  app:\n    image: alpine\n");

        expect(services).toHaveLength(1);
        expect(services[0].image).toBe("alpine");
        expect(services[0].imageTag).toBeNull();
    });

    it("handles port with protocol", () => {
        const services = parseComposeContent("services:\n  app:\n    image: app\n    ports:\n      - \"53:53/udp\"\n");

        expect(services[0].ports).toEqual([{host: 53, container: 53, protocol: "udp"}]);
    });

    it("returns empty array for empty content", () => {
        expect(parseComposeContent("")).toEqual([]);
    });

    it("returns empty array for YAML without services key", () => {
        expect(parseComposeContent("version: '3'\n")).toEqual([]);
    });

    it("handles multiple services", () => {
        const content = `
services:
  web:
    image: nginx:latest
  db:
    image: postgres:17
`;
        const services = parseComposeContent(content);
        expect(services).toHaveLength(2);
        expect(services.map((s) => s.serviceName)).toEqual(["web", "db"]);
    });

    it("handles service without image", () => {
        const services = parseComposeContent("services:\n  app:\n    build: .\n");

        expect(services).toHaveLength(1);
        expect(services[0].image).toBe("");
        expect(services[0].imageTag).toBeNull();
    });

    it("handles service without ports or volumes", () => {
        const services = parseComposeContent("services:\n  app:\n    image: alpine\n");

        expect(services[0].ports).toEqual([]);
        expect(services[0].volumes).toEqual([]);
    });

    it("ignores non-standard port format", () => {
        const services = parseComposeContent("services:\n  app:\n    image: app\n    ports:\n      - \"invalid\"\n");

        expect(services[0].ports).toEqual([]);
    });

    it("handles image with registry prefix and tag", () => {
        const services = parseComposeContent("services:\n  app:\n    image: ghcr.io/org/app:v1.2.3\n");

        expect(services[0].image).toBe("ghcr.io/org/app");
        expect(services[0].imageTag).toBe("v1.2.3");
    });
});

describe("hashComposeContent", () => {
    it("produces consistent SHA-256 hash", () => {
        const hash1 = hashComposeContent("test content");
        const hash2 = hashComposeContent("test content");

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it("produces different hashes for different content", () => {
        const hash1 = hashComposeContent("content a");
        const hash2 = hashComposeContent("content b");

        expect(hash1).not.toBe(hash2);
    });

    it("handles empty content", () => {
        const hash = hashComposeContent("");
        expect(hash).toHaveLength(64);
    });
});
