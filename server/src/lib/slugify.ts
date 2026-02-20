export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replaceAll(/[\s_]+/g, "-")
        .replaceAll(/[^a-z0-9-]/g, "")
        .replaceAll(/-{2,}/g, "-")
        .replaceAll(/(^-+)|(-+$)/g, "")
        .slice(0, 63);
}
