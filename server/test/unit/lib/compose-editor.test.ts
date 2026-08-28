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

    it("raises ComposeEditError for a missing service", () => {
        const content = "services:\n  app:\n    image: nginx:1.25\n";

        expect(() => getServiceImageTag(content, "missing")).toThrow(ComposeEditError);
    });
});
