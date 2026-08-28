import {describe, expect, it} from "vitest";
import {detectNoUpdates, toImageRef} from "../../../src/domain/image-update-detection.js";
import {buildImageRefFromService} from "../../../src/jobs/update-checker.js";

describe("toImageRef", () => {
    it("joins image and tag", () => {
        expect(toImageRef({image: "nginx", imageTag: "1.25"})).toBe("nginx:1.25");
    });

    it("defaults a missing tag to latest", () => {
        expect(toImageRef({image: "nginx", imageTag: null})).toBe("nginx:latest");
    });

    it("strips the docker.io/library/ prefix", () => {
        expect(toImageRef({image: "docker.io/library/redis", imageTag: "7"})).toBe("redis:7");
    });

    it("returns null for a blank image (build-only service)", () => {
        expect(toImageRef({image: "", imageTag: "1"})).toBeNull();
    });

    it("returns null for a null image", () => {
        expect(toImageRef({image: null, imageTag: null})).toBeNull();
    });

    describe("parity with buildImageRefFromService", () => {
        const cases: Array<{image: string; imageTag: string | null}> = [
            {image: "nginx", imageTag: "1.25"},
            {image: "nginx", imageTag: null},
            {image: "docker.io/library/redis", imageTag: "7"},
            {image: "ghcr.io/owner/app", imageTag: "v2"},
        ];

        it.each(cases)("matches buildImageRefFromService for %o", ({image, imageTag}) => {
            expect(toImageRef({image, imageTag})).toBe(buildImageRefFromService(image, imageTag));
        });
    });
});

describe("detectNoUpdates", () => {
    it("is true when the digest is unchanged", () => {
        expect(
            detectNoUpdates([{ref: "nginx:1.25", before: "sha256:aaa", after: "sha256:aaa"}]),
        ).toBe(true);
    });

    it("is false when the digest changed", () => {
        expect(
            detectNoUpdates([{ref: "nginx:1.25", before: "sha256:aaa", after: "sha256:bbb"}]),
        ).toBe(false);
    });

    it("is false when the image was absent before and present after", () => {
        expect(
            detectNoUpdates([{ref: "app:1", before: null, after: "sha256:aaa"}]),
        ).toBe(false);
    });

    it("is false when both digests are unknown (null)", () => {
        expect(detectNoUpdates([{ref: "app:1", before: null, after: null}])).toBe(false);
    });

    it("is false when both digests are empty strings", () => {
        expect(detectNoUpdates([{ref: "app:1", before: "", after: ""}])).toBe(false);
    });

    it("is false for an empty comparison list", () => {
        expect(detectNoUpdates([])).toBe(false);
    });

    it("is false when one entry is unchanged and another changed", () => {
        expect(
            detectNoUpdates([
                {ref: "nginx:1.25", before: "sha256:aaa", after: "sha256:aaa"},
                {ref: "redis:7", before: "sha256:ccc", after: "sha256:ddd"},
            ]),
        ).toBe(false);
    });
});
