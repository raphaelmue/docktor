import {describe, it, expect} from "vitest";
import {parse as parseYaml} from "yaml";
import {ComposeAnalyzer} from "../../../src/infrastructure/compose-analyzer.js";

// WR-04: consolidated from the former server/test/unit/compose-analyzer.test.ts
// (deleted) and server/test/unit/infrastructure/compose-analyzer.test.ts —
// merges the unique cases from both into this single canonical suite.
describe("ComposeAnalyzer", () => {
    const analyzer = new ComposeAnalyzer();

    describe("analyzeCompatibility (BF-02)", () => {
        it("should return green for compose with only relative bind mounts", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - ./data:/app/data
      - ./config:/app/config
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("green");
            expect(result.namedVolumes).toEqual([]);
            expect(result.bindMounts).toHaveLength(2);
            expect(result.inlineEnvVars).toEqual([]);
            expect(result.unsupportedFeatures).toEqual([]);
            expect(result.serviceCount).toBe(1);
        });

        it("should return yellow for compose with named volumes", () => {
            const compose = `
services:
  db:
    image: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.namedVolumes).toEqual(["pgdata"]);
            expect(result.unsupportedFeatures).toEqual([]);
        });

        it("should return yellow for compose with absolute bind mount paths", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - /mnt/nas/data:/app/data
      - ./config:/app/config
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.bindMounts.filter((m) => m.type === "absolute")).toHaveLength(1);
            expect(result.bindMounts.find((m) => m.path === "/mnt/nas/data")).toMatchObject({
                type: "absolute",
                serviceName: "app",
                containerPath: "/app/data",
            });
        });

        it("should return yellow for compose with inline environment variables", () => {
            const compose = `
services:
  app:
    image: nginx
    environment:
      PORT: 8080
      DEBUG: true
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.inlineEnvVars).toHaveLength(1);
            expect(result.inlineEnvVars[0]).toMatchObject({
                serviceName: "app",
                vars: {PORT: "8080", DEBUG: "true"},
            });
        });

        it("should return green for compose with array-form environment variables", () => {
            const compose = `
services:
  app:
    image: node:20
    environment:
      - NODE_ENV=\${NODE_ENV}
      - PORT=\${PORT}
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("green");
            expect(result.inlineEnvVars).toEqual([]);
        });

        it("should return red for compose with configs section", () => {
            const compose = `
services:
  app:
    image: nginx
configs:
  my_config:
    file: ./config.txt
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures).toContain("configs");
        });

        it("should return red for compose with secrets section", () => {
            const compose = `
services:
  app:
    image: nginx
secrets:
  my_secret:
    file: ./secret.txt
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures).toContain("secrets");
        });

        it("should return red for compose with depends_on conditions", () => {
            const compose = `
services:
  app:
    image: nginx
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures.some((f) => f.includes("depends_on condition"))).toBe(true);
        });

        it("should return green for compose with array-form depends_on", () => {
            const compose = `
services:
  app:
    image: nginx
    depends_on:
      - db
  db:
    image: postgres
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("green");
        });

        it("should detect multiple yellow flags and return yellow", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - /absolute/path:/app
      - namedvol:/data
    environment:
      KEY: value
volumes:
  namedvol:
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.namedVolumes).toContain("namedvol");
            expect(result.bindMounts.some((m) => m.type === "absolute" && m.path === "/absolute/path")).toBe(true);
            expect(result.inlineEnvVars.some((e) => e.serviceName === "app" && e.vars.KEY === "value")).toBe(true);
        });
    });

    describe("extractNamedVolumes", () => {
        it("should list all named volumes from top-level volumes key", () => {
            const doc = {
                services: {app: {image: "nginx"}},
                volumes: {data: {}, logs: null, cache: {}},
            };
            const volumes = analyzer.extractNamedVolumes(doc);
            expect(volumes).toEqual(["data", "logs", "cache"]);
        });

        it("should return empty array when no volumes section exists", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const volumes = analyzer.extractNamedVolumes(doc);
            expect(volumes).toEqual([]);
        });
    });

    describe("extractBindMounts", () => {
        it("should categorize relative and absolute bind mounts across services", () => {
            const doc = {
                services: {
                    app: {
                        image: "nginx",
                        volumes: ["./data:/app/data", "/mnt/nas:/app/nas", "named_volume:/app/vol"],
                    },
                    db: {
                        image: "postgres",
                        volumes: ["/var/lib/data:/var/lib/postgresql"],
                    },
                },
            };
            const mounts = analyzer.extractBindMounts(doc);
            expect(mounts).toHaveLength(3); // named volume excluded
            expect(mounts.find((m) => m.path === "./data")).toMatchObject({
                type: "relative",
                serviceName: "app",
                containerPath: "/app/data",
            });
            expect(mounts.find((m) => m.path === "/mnt/nas")).toMatchObject({
                type: "absolute",
                serviceName: "app",
                containerPath: "/app/nas",
            });
            expect(mounts.find((m) => m.path === "/var/lib/data")).toMatchObject({
                type: "absolute",
                serviceName: "db",
            });
        });

        it("should return empty array when no volumes", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const mounts = analyzer.extractBindMounts(doc);
            expect(mounts).toEqual([]);
        });

        it("should handle long-form bind mount syntax", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - type: bind
        source: ./data
        target: /app/data
`;
            const mounts = analyzer.extractBindMounts(parseYaml(compose));
            expect(mounts.some((m) => m.type === "relative" && m.path === "./data" && m.containerPath === "/app/data")).toBe(true);
        });

        it("should categorize a long-form bind mount with an absolute source as absolute", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - type: bind
        source: /mnt/nas
        target: /app/nas
`;
            const mounts = analyzer.extractBindMounts(parseYaml(compose));
            expect(mounts.some((m) => m.type === "absolute" && m.path === "/mnt/nas")).toBe(true);
        });

        it("should skip long-form named-volume entries (type: volume)", () => {
            const compose = `
services:
  db:
    image: postgres
    volumes:
      - type: volume
        source: pgdata
        target: /var/lib/postgresql/data
volumes:
  pgdata:
`;
            const mounts = analyzer.extractBindMounts(parseYaml(compose));
            expect(mounts).toEqual([]);
        });
    });

    describe("extractInlineEnvVars", () => {
        it("should detect object-form environment variables across services", () => {
            const doc = {
                services: {
                    app: {
                        image: "node",
                        environment: {NODE_ENV: "production", PORT: 3000, DEBUG: false},
                    },
                    worker: {
                        image: "node",
                        environment: {QUEUE_URL: "redis://localhost"},
                    },
                },
            };
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                serviceName: "app",
                vars: {NODE_ENV: "production", PORT: "3000", DEBUG: "false"},
            });
            expect(result[1]).toMatchObject({
                serviceName: "worker",
                vars: {QUEUE_URL: "redis://localhost"},
            });
        });

        it("should not flag array-form environment references as inline", () => {
            const doc = {
                services: {
                    app: {image: "node", environment: ["NODE_ENV=${NODE_ENV}", "PORT=${PORT}"]},
                },
            };
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toEqual([]);
        });

        it("should return empty array when no environment key", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toEqual([]);
        });

        it("should handle mixed inline and reference env vars", () => {
            const compose = `
services:
  app:
    image: nginx
    environment:
      PORT: 8080
      HOST: \${HOST}
`;
            const envVars = analyzer.extractInlineEnvVars(parseYaml(compose));
            const appVars = envVars.find((e) => e.serviceName === "app")?.vars;
            expect(appVars).toHaveProperty("PORT", "8080");
            expect(appVars).not.toHaveProperty("HOST");
        });
    });
});
