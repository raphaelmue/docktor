import {describe, it, expect} from "vitest";
import {ComposeAnalyzer, type CompatibilityLevel} from "../../src/infrastructure/compose-analyzer.js";

describe("ComposeAnalyzer", () => {
    const analyzer = new ComposeAnalyzer();

    describe("analyzeCompatibility", () => {
        it("returns green for compose with only relative bind mounts", () => {
            const compose = `
services:
  app:
    image: nginx:latest
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

        it("returns yellow for compose with named volumes", () => {
            const compose = `
services:
  app:
    image: postgres:15
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

        it("returns yellow for compose with absolute bind mount paths", () => {
            const compose = `
services:
  app:
    image: nginx:latest
    volumes:
      - /mnt/nas/data:/app/data
      - ./config:/app/config
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.bindMounts.filter(m => m.type === "absolute")).toHaveLength(1);
            expect(result.bindMounts.find(m => m.path === "/mnt/nas/data")).toMatchObject({
                type: "absolute",
                serviceName: "app",
                containerPath: "/app/data",
            });
        });

        it("returns yellow for compose with inline environment variables", () => {
            const compose = `
services:
  app:
    image: node:20
    environment:
      NODE_ENV: production
      PORT: 3000
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.inlineEnvVars).toHaveLength(1);
            expect(result.inlineEnvVars[0]).toMatchObject({
                serviceName: "app",
                vars: {NODE_ENV: "production", PORT: "3000"},
            });
        });

        it("returns green for compose with array-form environment variables", () => {
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

        it("returns red for compose with configs section", () => {
            const compose = `
services:
  app:
    image: nginx:latest
    configs:
      - source: nginx_config
        target: /etc/nginx/nginx.conf

configs:
  nginx_config:
    file: ./nginx.conf
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures).toContain("configs");
        });

        it("returns red for compose with secrets section", () => {
            const compose = `
services:
  app:
    image: nginx:latest
    secrets:
      - db_password

secrets:
  db_password:
    file: ./db_password.txt
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures).toContain("secrets");
        });

        it("returns red for compose with depends_on conditions", () => {
            const compose = `
services:
  app:
    image: nginx:latest
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:15
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
            expect(result.unsupportedFeatures.some(f => f.includes("depends_on condition"))).toBe(true);
        });

        it("returns green for compose with array-form depends_on", () => {
            const compose = `
services:
  app:
    image: nginx:latest
    depends_on:
      - db
  db:
    image: postgres:15
`;
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("green");
        });
    });

    describe("extractNamedVolumes", () => {
        it("extracts volume names from top-level volumes key", () => {
            const doc = {
                services: {app: {image: "nginx"}},
                volumes: {
                    pgdata: {},
                    redis: null,
                },
            };
            const result = analyzer.extractNamedVolumes(doc);
            expect(result).toEqual(["pgdata", "redis"]);
        });

        it("returns empty array when no volumes key", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const result = analyzer.extractNamedVolumes(doc);
            expect(result).toEqual([]);
        });
    });

    describe("extractBindMounts", () => {
        it("categorizes relative and absolute bind mounts", () => {
            const doc = {
                services: {
                    app: {
                        image: "nginx",
                        volumes: [
                            "./data:/app/data",
                            "/mnt/nas:/app/nas",
                            "named_volume:/app/vol",
                        ],
                    },
                    db: {
                        image: "postgres",
                        volumes: ["/var/lib/data:/var/lib/postgresql"],
                    },
                },
            };
            const result = analyzer.extractBindMounts(doc);
            expect(result).toHaveLength(3); // Named volume excluded
            expect(result.find(m => m.path === "./data")).toMatchObject({
                type: "relative",
                serviceName: "app",
                containerPath: "/app/data",
            });
            expect(result.find(m => m.path === "/mnt/nas")).toMatchObject({
                type: "absolute",
                serviceName: "app",
                containerPath: "/app/nas",
            });
            expect(result.find(m => m.path === "/var/lib/data")).toMatchObject({
                type: "absolute",
                serviceName: "db",
            });
        });

        it("returns empty array when no volumes", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const result = analyzer.extractBindMounts(doc);
            expect(result).toEqual([]);
        });
    });

    describe("extractInlineEnvVars", () => {
        it("detects object-form environment variables", () => {
            const doc = {
                services: {
                    app: {
                        image: "node",
                        environment: {
                            NODE_ENV: "production",
                            PORT: 3000,
                            DEBUG: false,
                        },
                    },
                    worker: {
                        image: "node",
                        environment: {
                            QUEUE_URL: "redis://localhost",
                        },
                    },
                },
            };
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                serviceName: "app",
                vars: {
                    NODE_ENV: "production",
                    PORT: "3000",
                    DEBUG: "false",
                },
            });
            expect(result[1]).toMatchObject({
                serviceName: "worker",
                vars: {QUEUE_URL: "redis://localhost"},
            });
        });

        it("ignores array-form environment variables", () => {
            const doc = {
                services: {
                    app: {
                        image: "node",
                        environment: ["NODE_ENV=${NODE_ENV}", "PORT=${PORT}"],
                    },
                },
            };
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toEqual([]);
        });

        it("returns empty array when no environment key", () => {
            const doc = {services: {app: {image: "nginx"}}};
            const result = analyzer.extractInlineEnvVars(doc);
            expect(result).toEqual([]);
        });
    });
});
