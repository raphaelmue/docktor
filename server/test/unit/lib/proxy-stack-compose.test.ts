import {describe, expect, it} from "vitest";
import {parseDocument} from "yaml";
import {
    ACME_COMPANION_CONTAINER_NAME,
    ACME_COMPANION_IMAGE,
    NGINX_PROXY_CONTAINER_NAME,
    NGINX_PROXY_IMAGE,
    PROXY_CERTS_SUBPATH,
    renderProxyStackCompose,
} from "../../../src/lib/proxy-stack-compose.js";

describe("renderProxyStackCompose", () => {
    it("parses with no errors for an empty acmeEmail", () => {
        const output = renderProxyStackCompose({acmeEmail: ""});
        const doc = parseDocument(output);

        expect(doc.errors).toHaveLength(0);
    });

    it("declares exactly the service keys nginx-proxy and acme-companion", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const services = doc.getIn(["services"]) as any;

        expect(Object.keys(services.toJSON())).toEqual(["nginx-proxy", "acme-companion"]);
    });

    it("pins both images to a specific version tag, neither ending in :latest", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const json = doc.toJSON();

        expect(json.services["nginx-proxy"].image).toBe(NGINX_PROXY_IMAGE);
        expect(json.services["acme-companion"].image).toBe(ACME_COMPANION_IMAGE);
        expect(json.services["nginx-proxy"].image.endsWith(":latest")).toBe(false);
        expect(json.services["acme-companion"].image.endsWith(":latest")).toBe(false);
    });

    it("sets container_name on each service and NGINX_PROXY_CONTAINER on the companion", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const json = doc.toJSON();

        expect(json.services["nginx-proxy"].container_name).toBe(NGINX_PROXY_CONTAINER_NAME);
        expect(json.services["acme-companion"].container_name).toBe(ACME_COMPANION_CONTAINER_NAME);
        expect(json.services["acme-companion"].environment.NGINX_PROXY_CONTAINER).toBe(NGINX_PROXY_CONTAINER_NAME);
    });

    it("publishes exactly 80:80 and 443:443 on nginx-proxy and no ports on acme-companion", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const json = doc.toJSON();

        expect(json.services["nginx-proxy"].ports).toEqual(["80:80", "443:443"]);
        expect(json.services["acme-companion"].ports).toBeUndefined();
    });

    it("declares the top-level docktor_proxy network with an explicit name and no external key", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const json = doc.toJSON();

        expect(json.networks.docktor_proxy.name).toBe("docktor_proxy");
        expect(json.networks.docktor_proxy.external).toBeUndefined();
    });

    it("has no top-level volumes key — every mount is a bind mount path", () => {
        const doc = parseDocument(renderProxyStackCompose({acmeEmail: ""}));
        const json = doc.toJSON();

        expect(json.volumes).toBeUndefined();
        for (const service of Object.values(json.services) as any[]) {
            for (const volume of service.volumes ?? []) {
                expect(typeof volume).toBe("string");
                expect(volume.startsWith("./volumes/") || volume.startsWith("/var/run/docker.sock")).toBe(true);
            }
        }
    });

    it("omits DEFAULT_EMAIL for an empty email and includes it for a non-empty one", () => {
        const emptyJson = parseDocument(renderProxyStackCompose({acmeEmail: ""})).toJSON();
        expect(emptyJson.services["acme-companion"].environment.DEFAULT_EMAIL).toBeUndefined();

        const filledJson = parseDocument(renderProxyStackCompose({acmeEmail: "admin@example.com"})).toJSON();
        expect(filledJson.services["acme-companion"].environment.DEFAULT_EMAIL).toBe("admin@example.com");
    });

    it("round-trips an adversarial acmeEmail (newline, double quote, YAML indicator #) with no parse errors and an exact value match", () => {
        const adversarial = 'weird\n"quoted"\n# not-a-comment@example.com';
        const output = renderProxyStackCompose({acmeEmail: adversarial});
        const doc = parseDocument(output);

        expect(doc.errors).toHaveLength(0);
        const json = doc.toJSON();
        expect(json.services["acme-companion"].environment.DEFAULT_EMAIL).toBe(adversarial);
    });

    it("exports PROXY_CERTS_SUBPATH as volumes/certs", () => {
        expect(PROXY_CERTS_SUBPATH).toBe("volumes/certs");
    });

    it("mounts the docker socket into both containers with a disclosure comment above each mount", () => {
        const output = renderProxyStackCompose({acmeEmail: ""});

        expect((output.match(/docker\.sock/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect(output).toMatch(/host-root-equivalent reach/);
    });
});
