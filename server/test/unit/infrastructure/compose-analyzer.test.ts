import {describe, it, expect} from "vitest";
import {parse as parseYaml} from "yaml";
import {ComposeAnalyzer} from "../../../src/infrastructure/compose-analyzer.js";

describe("ComposeAnalyzer", () => {
    describe("analyzeCompatibility (BF-02)", () => {
        it("should return green for compose with only relative bind mounts", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - ./data:/app/data
`;
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("green");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
        });

        it("should return yellow for compose with absolute bind mount paths", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - /mnt/nas/data:/app/data
`;
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("red");
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
            const analyzer = new ComposeAnalyzer();
            const result = analyzer.analyzeCompatibility(compose);
            expect(result.compatibility).toBe("yellow");
            expect(result.namedVolumes).toContain("namedvol");
            expect(result.bindMounts.some((m) => m.type === "absolute" && m.path === "/absolute/path")).toBe(true);
            expect(result.inlineEnvVars.some((e) => e.serviceName === "app" && e.vars.KEY === "value")).toBe(true);
        });
    });

    describe("extractNamedVolumes", () => {
        it("should list all named volumes from top-level volumes key", () => {
            const compose = `
services:
  app:
    image: nginx
volumes:
  data:
  logs:
  cache:
`;
            const analyzer = new ComposeAnalyzer();
            const volumes = analyzer.extractNamedVolumes(parseYaml(compose));
            expect(volumes).toEqual(["data", "logs", "cache"]);
        });

        it("should return empty array when no volumes section exists", () => {
            const compose = `
services:
  app:
    image: nginx
`;
            const analyzer = new ComposeAnalyzer();
            const volumes = analyzer.extractNamedVolumes(parseYaml(compose));
            expect(volumes).toEqual([]);
        });
    });

    describe("extractBindMounts", () => {
        it("should categorize bind mounts as relative or absolute", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - ./data:/app/data
      - /mnt/nas:/app/nas
      - ../config:/app/config
`;
            const analyzer = new ComposeAnalyzer();
            const mounts = analyzer.extractBindMounts(parseYaml(compose));
            const relativePaths = mounts.filter((m) => m.type === "relative").map((m) => m.path);
            const absolutePaths = mounts.filter((m) => m.type === "absolute").map((m) => m.path);
            expect(relativePaths).toContain("./data");
            expect(relativePaths).toContain("../config");
            expect(absolutePaths).toContain("/mnt/nas");
        });

        it("should handle volume long-form syntax", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - type: bind
        source: ./data
        target: /app/data
`;
            const analyzer = new ComposeAnalyzer();
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
            const analyzer = new ComposeAnalyzer();
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
            const analyzer = new ComposeAnalyzer();
            const mounts = analyzer.extractBindMounts(parseYaml(compose));
            expect(mounts).toEqual([]);
        });
    });

    describe("extractInlineEnvVars", () => {
        it("should detect object-form environment variables", () => {
            const compose = `
services:
  app:
    image: nginx
    environment:
      PORT: 8080
      DEBUG: true
`;
            const analyzer = new ComposeAnalyzer();
            const envVars = analyzer.extractInlineEnvVars(parseYaml(compose));
            const appVars = envVars.find((e) => e.serviceName === "app")?.vars;
            expect(appVars).toHaveProperty("PORT", "8080");
            expect(appVars).toHaveProperty("DEBUG", "true");
        });

        it("should not flag array-form environment references as inline", () => {
            const compose = `
services:
  app:
    image: nginx
    environment:
      - PORT=\${PORT}
      - DEBUG=\${DEBUG}
`;
            const analyzer = new ComposeAnalyzer();
            const envVars = analyzer.extractInlineEnvVars(parseYaml(compose));
            expect(envVars.length).toBe(0);
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
            const analyzer = new ComposeAnalyzer();
            const envVars = analyzer.extractInlineEnvVars(parseYaml(compose));
            const appVars = envVars.find((e) => e.serviceName === "app")?.vars;
            expect(appVars).toHaveProperty("PORT", "8080");
            expect(appVars).not.toHaveProperty("HOST");
        });
    });
});
