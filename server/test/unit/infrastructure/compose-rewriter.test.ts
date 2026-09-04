import {describe, it, expect} from "vitest";
import {parse as parseYaml} from "yaml";
import {ComposeRewriter} from "../../../src/infrastructure/compose-rewriter.js";

describe("ComposeRewriter", () => {
    describe("rewrite (CR-03: long-form volume entries)", () => {
        it("should rewrite the source of a long-form bind mount selected for conversion", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - type: bind
        source: /mnt/nas/data
        target: /app/data
`;
            const rewriter = new ComposeRewriter();
            const result = rewriter.rewrite(
                compose,
                [{originalPath: "/mnt/nas/data", newPath: "./volumes/data", convert: true}],
                new Map(),
            );

            const doc = parseYaml(result.rewrittenCompose);
            const [vol] = doc.services.app.volumes;
            expect(vol.type).toBe("bind");
            expect(vol.source).toBe("./volumes/data");
            expect(vol.target).toBe("/app/data");
        });

        it("should leave a long-form bind mount untouched when not selected for conversion", () => {
            const compose = `
services:
  app:
    image: nginx
    volumes:
      - type: bind
        source: /mnt/nas/data
        target: /app/data
`;
            const rewriter = new ComposeRewriter();
            const result = rewriter.rewrite(compose, [], new Map());

            const doc = parseYaml(result.rewrittenCompose);
            const [vol] = doc.services.app.volumes;
            expect(vol.source).toBe("/mnt/nas/data");
        });

        it("should convert a long-form named-volume entry to a bind mount when selected", () => {
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
            const rewriter = new ComposeRewriter();
            const result = rewriter.rewrite(compose, [], new Map([["pgdata", true]]));

            const doc = parseYaml(result.rewrittenCompose);
            const [vol] = doc.services.db.volumes;
            expect(vol.type).toBe("bind");
            expect(vol.source).toBe("./volumes/pgdata");
            expect(vol.target).toBe("/var/lib/postgresql/data");
        });

        it("should keep a long-form named-volume entry unchanged when not converted, and mark it external", () => {
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
            const rewriter = new ComposeRewriter();
            const result = rewriter.rewrite(compose, [], new Map([["pgdata", false]]));

            const doc = parseYaml(result.rewrittenCompose);
            const [vol] = doc.services.db.volumes;
            expect(vol.type).toBe("volume");
            expect(vol.source).toBe("pgdata");
            expect(doc.volumes.pgdata.external).toBe(true);
        });
    });
});
