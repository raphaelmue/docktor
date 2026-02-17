export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63);
}
