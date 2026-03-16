import {describe, expect, it} from "vitest";
import {createComposeConfig} from "../../../src/domain/compose-config.js";

const VALID_COMPOSE = `
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html
  db:
    image: postgres:17
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
`;

describe("createComposeConfig", () => {
    it("parses valid compose content into services", () => {
        const config = createComposeConfig(VALID_COMPOSE);

        expect(config.services).toHaveLength(2);

        const web = config.services.find((s) => s.serviceName === "web")!;
        expect(web.image).toBe("nginx");
        expect(web.imageTag).toBe("latest");
        expect(web.ports).toEqual([{host: 8080, container: 80, protocol: "tcp"}]);
        expect(web.volumes).toEqual([
            {hostPath: "./html", containerPath: "/usr/share/nginx/html"},
        ]);

        const db = config.services.find((s) => s.serviceName === "db")!;
        expect(db.image).toBe("postgres");
        expect(db.imageTag).toBe("17");
    });

    it("produces a consistent SHA-256 hash", () => {
        const config1 = createComposeConfig(VALID_COMPOSE);
        const config2 = createComposeConfig(VALID_COMPOSE);
        expect(config1.hash).toBe(config2.hash);
        expect(config1.hash).toHaveLength(64); // SHA-256 hex
    });

    it("produces different hashes for different content", () => {
        const config1 = createComposeConfig(VALID_COMPOSE);
        const config2 = createComposeConfig("services:\n  app:\n    image: alpine\n");
        expect(config1.hash).not.toBe(config2.hash);
    });

    it("throws for empty content", () => {
        expect(() => createComposeConfig("")).toThrow("Compose file missing 'services' key");
    });

    it("throws for YAML without services key", () => {
        expect(() => createComposeConfig("version: '3'\n")).toThrow("Compose file missing 'services' key");
    });

    it("handles image without tag", () => {
        const config = createComposeConfig("services:\n  app:\n    image: alpine\n");
        expect(config.services).toHaveLength(1);
        expect(config.services[0].image).toBe("alpine");
        expect(config.services[0].imageTag).toBeNull();
    });
});
