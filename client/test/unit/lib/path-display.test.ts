import {describe, it, expect} from "vitest";
import {directoryDisplayName} from "../../../src/lib/path-display";

// G-05.1-4: the server's scan result now carries host-OS-native separators,
// so a Windows deployment can hand the client backslash-separated paths,
// and bind-mount values read out of an operator's compose file may already
// be Windows-shaped regardless of where the server runs. These tests pin
// directoryDisplayName()'s behavior across every separator style it must
// tolerate.
describe("directoryDisplayName", () => {
    it("returns the final segment of a POSIX path", () => {
        expect(directoryDisplayName("/opt/myapp")).toBe("myapp");
    });

    it("returns the final segment of a Windows path", () => {
        expect(directoryDisplayName("C:\\Users\\D\\Stacks\\myapp")).toBe("myapp");
    });

    it("returns the final segment of a drive-qualified Windows path", () => {
        expect(directoryDisplayName("C:\\myapp")).toBe("myapp");
    });

    it("returns the final segment of a path mixing both separator styles", () => {
        expect(directoryDisplayName("C:/Users\\D/Stacks\\myapp")).toBe("myapp");
    });

    it("ignores one or more trailing separators", () => {
        expect(directoryDisplayName("/opt/myapp/")).toBe("myapp");
        expect(directoryDisplayName("C:\\Users\\D\\myapp\\\\")).toBe("myapp");
    });

    it("returns an empty string for an empty input", () => {
        expect(directoryDisplayName("")).toBe("");
    });

    it("returns an empty string for a bare POSIX root", () => {
        expect(directoryDisplayName("/")).toBe("");
    });

    it("returns an empty string for a bare Windows drive root", () => {
        expect(directoryDisplayName("C:\\")).toBe("");
    });

    it("never returns a value containing either separator character", () => {
        const result = directoryDisplayName("C:/Users\\D/Stacks\\myapp");
        expect(result).not.toContain("/");
        expect(result).not.toContain("\\");
    });
});
