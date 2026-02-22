import {defineConfig} from "vitest/config";
import react from "@vitejs/plugin-react";
import * as path from "node:path";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./test/setup.ts"],
        include: ["test/unit/**/*.test.{ts,tsx}"],
        coverage: {
            enabled: true,
            provider: "v8",
            reporter: ["lcov", "text"],
            reportsDirectory: ".test/coverage",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/generated/**", "src/components/ui/**"],

        },
    },
});
