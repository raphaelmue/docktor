import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: "unit",
                    include: ["test/unit/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "test/integration",
                    include: ["test/integration/**/*.test.ts"],
                    testTimeout: 30_000,
                    hookTimeout: 30_000,
                },
            },
        ],
        coverage: {
            enabled: true,
            provider: "v8",
            reporter: ["lcov", "text"],
            reportsDirectory: ".test/coverage",
            include: ["src/**/*.ts"],
            exclude: ["src/generated/**"],
        },
    },
});
