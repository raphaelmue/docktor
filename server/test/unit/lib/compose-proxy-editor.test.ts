import {describe, expect, it} from "vitest";
import {
    ComposeProxyEditError,
    PROXY_NETWORK_NAME,
    readServiceProxyEnv,
    setServiceProxyEnv,
} from "../../../src/lib/compose-proxy-editor.js";

describe("setServiceProxyEnv", () => {
    it("sets VIRTUAL_HOST and VIRTUAL_PORT (as a string scalar) on the target service", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        const result = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        expect(result).toContain("VIRTUAL_HOST: app.example.com");
        expect(result).toContain('VIRTUAL_PORT: "8080"');
    });

    it("sets LETSENCRYPT_HOST when letsencryptHost is a non-empty string", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        const result = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: "app.example.com",
        });

        expect(result).toContain("LETSENCRYPT_HOST: app.example.com");
    });

    it("deletes LETSENCRYPT_HOST when letsencryptHost is null and the key was previously present, leaving the file otherwise unchanged", () => {
        const withCert = setServiceProxyEnv(
            "services:\n  web:\n    image: nginx:latest\n",
            "web",
            {virtualHost: "app.example.com", virtualPort: "8080", letsencryptHost: "app.example.com"},
        );

        const result = setServiceProxyEnv(withCert, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        expect(result).not.toContain("LETSENCRYPT_HOST");
        expect(result).toContain("VIRTUAL_HOST: app.example.com");
        expect(result).toContain('VIRTUAL_PORT: "8080"');
    });

    it("appends docktor_proxy to the service's networks exactly once across repeated calls", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n    networks:\n      - default\n";

        const once = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });
        const twice = setServiceProxyEnv(once, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        const occurrences = (twice.match(/docktor_proxy/g) ?? []).length;
        // one in services.web.networks, one in the top-level networks key
        expect(occurrences).toBe(2);
        expect(twice).toContain("- default");
        expect(twice).toContain(`- ${PROXY_NETWORK_NAME}`);
    });

    it("sets the top-level networks.docktor_proxy.external to true", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        const result = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        expect(result).toMatch(/networks:\s*\n\s*docktor_proxy:\s*\n\s*external: true/);
    });

    it("produces exactly one VIRTUAL_HOST key with a comma-joined value for multiple domains (D-08 promote invariant)", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        const result = setServiceProxyEnv(content, "web", {
            virtualHost: "a.example.com,b.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        const matches = result.match(/VIRTUAL_HOST:/g) ?? [];
        expect(matches).toHaveLength(1);
        expect(result).toContain("VIRTUAL_HOST: a.example.com,b.example.com");
    });

    it("leaves a comment line, a single-quoted image value, and an unrelated second service byte-identical outside the mutated blocks", () => {
        const content = [
            "# managed by the operator",
            "services:",
            "  web:",
            "    image: 'nginx:latest' # pinned",
            "  sidecar:",
            "    image: redis:7",
            "",
        ].join("\n");

        const result = setServiceProxyEnv(content, "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: null,
        });

        expect(result).toBe(
            [
                "# managed by the operator",
                "services:",
                "  web:",
                "    image: 'nginx:latest' # pinned",
                "    environment:",
                "      VIRTUAL_HOST: app.example.com",
                '      VIRTUAL_PORT: "8080"',
                "    networks:",
                "      - docktor_proxy",
                "  sidecar:",
                "    image: redis:7",
                "networks:",
                "  docktor_proxy:",
                "    external: true",
                "",
            ].join("\n"),
        );
    });

    it("raises ComposeProxyEditError with reason 'service-not-found' for an unknown service", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        try {
            setServiceProxyEnv(content, "missing", {
                virtualHost: "app.example.com",
                virtualPort: "8080",
                letsencryptHost: null,
            });
            expect.fail("expected ComposeProxyEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeProxyEditError);
            expect((err as ComposeProxyEditError).reason).toBe("service-not-found");
        }
    });

    it("raises ComposeProxyEditError with reason 'no-services' when the document has no services key", () => {
        const content = "version: '3'\n";

        try {
            setServiceProxyEnv(content, "web", {
                virtualHost: "app.example.com",
                virtualPort: "8080",
                letsencryptHost: null,
            });
            expect.fail("expected ComposeProxyEditError to be thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ComposeProxyEditError);
            expect((err as ComposeProxyEditError).reason).toBe("no-services");
        }
    });
});

describe("readServiceProxyEnv", () => {
    it("returns virtualHost/virtualPort/letsencryptHost with null for absent keys", () => {
        const content = "services:\n  web:\n    image: nginx:latest\n";

        expect(readServiceProxyEnv(content, "web")).toEqual({
            virtualHost: null,
            virtualPort: null,
            letsencryptHost: null,
        });
    });

    it("returns the values previously written by setServiceProxyEnv", () => {
        const content = setServiceProxyEnv("services:\n  web:\n    image: nginx:latest\n", "web", {
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: "app.example.com",
        });

        expect(readServiceProxyEnv(content, "web")).toEqual({
            virtualHost: "app.example.com",
            virtualPort: "8080",
            letsencryptHost: "app.example.com",
        });
    });
});
