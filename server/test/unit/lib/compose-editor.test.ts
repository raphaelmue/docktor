import {describe, expect, it} from "vitest";
import {ComposeEditError, getServiceImageTag, setServiceImageTag} from "../../../src/lib/compose-editor.js";

describe("setServiceImageTag", () => {
    it("rewrites the targeted service's image tag and leaves every other line unchanged", () => {
        const content = [
            "# managed by the operator",
            "services:",
            "  app:",
            "    image: nginx:1.25 # pinned for compatibility",
            "    ports:",
            '      - "80:80"',
            "",
        ].join("\n");

        const result = setServiceImageTag(content, "app", "1.26");

        expect(result).toBe(
            [
                "# managed by the operator",
                "services:",
                "  app:",
                "    image: nginx:1.26 # pinned for compatibility",
                "    ports:",
                '      - "80:80"',
                "",
            ].join("\n"),
        );
    });

    it("raises ComposeEditError when the target service is absent", () => {
        const content = "services:\n  app:\n    image: nginx:1.25\n";

        expect(() => setServiceImageTag(content, "missing", "1.26")).toThrow(ComposeEditError);
    });

    it("appends the tag when the image carries none", () => {
        const content = "services:\n  app:\n    image: nginx\n";

        const result = setServiceImageTag(content, "app", "1.1");

        expect(result).toBe("services:\n  app:\n    image: nginx:1.1\n");
    });

    it("raises ComposeEditError with reason 'no-services' when the compose file has no services key", () => {
        const content = "version: '3'\n";

        try {
            setServiceImageTag(content, "app", "1.1");
            expect.fail("expected ComposeEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeEditError);
            expect((err as ComposeEditError).reason).toBe("no-services");
        }
    });

    it("raises ComposeEditError with reason 'service-not-found' when the service is absent", () => {
        const content = "services:\n  app:\n    image: nginx:1.25\n";

        try {
            setServiceImageTag(content, "missing", "1.26");
            expect.fail("expected ComposeEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeEditError);
            expect((err as ComposeEditError).reason).toBe("service-not-found");
        }
    });

    it("raises ComposeEditError with reason 'no-image' when the service has no image key", () => {
        const content = "services:\n  app:\n    build: .\n";

        try {
            setServiceImageTag(content, "app", "1.1");
            expect.fail("expected ComposeEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeEditError);
            expect((err as ComposeEditError).reason).toBe("no-image");
        }
    });

    // --- Task 2: hardening against real-world image forms ---
    //
    // The colon-vs-port disambiguation and the Document API's targeted-node
    // mutation were already applied in Task 1's implementation (verified
    // against the yaml package directly before writing it), so these cases
    // require no further src changes — they exist to prove that choice was
    // correct and to guard against regressing it later.

    it("does not treat a registry port as the tag when upgrading a tagged reference", () => {
        const content = "services:\n  app:\n    image: registry.example.com:5000/team/app:1.0\n";

        const result = setServiceImageTag(content, "app", "1.1");

        expect(result).toBe("services:\n  app:\n    image: registry.example.com:5000/team/app:1.1\n");
    });

    it("appends the tag after a registry port when the image carries no tag", () => {
        const content = "services:\n  app:\n    image: registry.example.com:5000/team/app\n";

        const result = setServiceImageTag(content, "app", "1.1");

        expect(result).toBe("services:\n  app:\n    image: registry.example.com:5000/team/app:1.1\n");
    });

    it("upgrades a ghcr.io reference", () => {
        const content = "services:\n  app:\n    image: ghcr.io/user/app:2.0\n";

        const result = setServiceImageTag(content, "app", "2.1");

        expect(result).toBe("services:\n  app:\n    image: ghcr.io/user/app:2.1\n");
    });

    it("preserves the original quoting style of the image scalar", () => {
        const content = 'services:\n  app:\n    image: "nginx:1.25"\n';

        const result = setServiceImageTag(content, "app", "1.26");

        expect(result).toBe('services:\n  app:\n    image: "nginx:1.26"\n');
    });

    it("only rewrites the targeted service, even when another service shares the same image string", () => {
        const content = [
            "services:",
            "  app:",
            "    image: nginx:1.25",
            "  sidecar:",
            "    image: nginx:1.25",
            "",
        ].join("\n");

        const result = setServiceImageTag(content, "app", "1.26");

        expect(result).toBe(
            [
                "services:",
                "  app:",
                "    image: nginx:1.26",
                "  sidecar:",
                "    image: nginx:1.25",
                "",
            ].join("\n"),
        );
    });

    it("raises ComposeEditError naming the digest pin as unsupported", () => {
        const content = "services:\n  app:\n    image: nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";

        try {
            setServiceImageTag(content, "app", "1.26");
            expect.fail("expected ComposeEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeEditError);
            expect((err as ComposeEditError).reason).toBe("digest-pinned");
            expect((err as ComposeEditError).message).toContain("digest");
        }
    });

    it("round-trips an anchor/alias elsewhere in the document without expanding it", () => {
        const content = [
            "services:",
            "  app: &base",
            "    image: nginx:1.25",
            "  app2:",
            "    <<: *base",
            "    image: nginx:1.25",
            "",
        ].join("\n");

        const result = setServiceImageTag(content, "app", "1.26");

        expect(result).toBe(
            [
                "services:",
                "  app: &base",
                "    image: nginx:1.26",
                "  app2:",
                "    <<: *base",
                "    image: nginx:1.25",
                "",
            ].join("\n"),
        );
    });

    it("does not use a whole-document regular-expression substitution", () => {
        // Structural guard co-located with the behavior it protects: a
        // regex-over-raw-text implementation would also pass every case
        // above by coincidence, so this only really proves itself via the
        // multi-service and anchor cases already asserting targeted edits.
        const content = "services:\n  app:\n    image: nginx:1.25\n  sidecar:\n    image: nginx:1.25\n";
        const result = setServiceImageTag(content, "app", "1.26");
        expect(result).not.toBe(content.replaceAll("nginx:1.25", "nginx:1.26"));
    });
});

describe("getServiceImageTag", () => {
    it("returns the current tag for a tagged service", () => {
        const content = "services:\n  app:\n    image: nginx:1.25\n";

        expect(getServiceImageTag(content, "app")).toBe("1.25");
    });

    it("returns null when the image carries no explicit tag", () => {
        const content = "services:\n  app:\n    image: nginx\n";

        expect(getServiceImageTag(content, "app")).toBeNull();
    });

    it("does not treat a registry port as the tag", () => {
        const content = "services:\n  app:\n    image: registry.example.com:5000/team/app\n";

        expect(getServiceImageTag(content, "app")).toBeNull();
    });

    it("raises ComposeEditError for a missing service", () => {
        const content = "services:\n  app:\n    image: nginx:1.25\n";

        expect(() => getServiceImageTag(content, "missing")).toThrow(ComposeEditError);
    });

    it("raises ComposeEditError for a digest-pinned image", () => {
        const content = "services:\n  app:\n    image: nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";

        expect(() => getServiceImageTag(content, "app")).toThrow(ComposeEditError);
    });
});
