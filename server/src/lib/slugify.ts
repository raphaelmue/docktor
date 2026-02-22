export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replaceAll(/[\s_]+/g, "-")
        .replaceAll(/[^a-z0-9-]/g, "")
        .replaceAll(/-{2,}/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .slice(0, 63);
}
