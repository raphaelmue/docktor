import {defineConfig} from "vitest/config";
import {resolve} from "node:path";

export default defineConfig({
    resolve: {
        alias: [
            // Allows tests to import via deep relative "../../../../src/..." paths
            // regardless of test subdirectory nesting depth
            {
                find: /^(?:\.\.\/)+src\//,
                replacement: resolve(__dirname, "src") + "/",
            },
        ],
    },
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
