// G-05.1-4: the server's brownfield scan result carries host-OS-native path
// separators, so a Windows deployment can hand this client backslash-shaped
// paths. Bind-mount values read out of an operator's compose file
// (DiscoveredStack.absolutePaths) may also be Windows-shaped regardless of
// where the server itself runs. This module derives a display-friendly
// trailing path segment tolerant of either separator style, or a mix of
// both, so no consumer regresses when a path stops being POSIX-only.

/**
 * Returns the final path segment of `directory`, tolerant of POSIX (`/`),
 * Windows (`\`), or mixed separator styles. Trailing separators are
 * ignored rather than producing an empty result. Returns an empty string
 * for an empty input or a bare root (POSIX `/` or a Windows drive root
 * like `C:\`), leaving fallback text to the caller.
 */
export function directoryDisplayName(directory: string): string {
    const trimmed = directory.replace(/[/\\]+$/, "");

    // A bare root — POSIX "/" (trims to ""), or a Windows drive root like
    // "C:\" or "C:" (trims to just the drive letter and colon) — has no
    // name segment to display.
    if (trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) {
        return "";
    }

    const segments = trimmed.split(/[/\\]+/).filter((segment) => segment.length > 0);
    return segments.at(-1) ?? "";
}
