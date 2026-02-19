import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/unit/**/*.test.ts"],
        coverage: {
            enabled: true,
            provider: "v8",
            reporter: ["lcov", "text"],
            reportsDirectory: ".test/coverage",
            include: ["src/**/*.ts"],
        },
    },
});
