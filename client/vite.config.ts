import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import istanbul from "vite-plugin-istanbul";
import * as path from "node:path";

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        // Instrument source with Istanbul counters when running Playwright tests
        process.env.VITE_COVERAGE === "true" &&
            istanbul({
                include: "src/**",
                exclude: ["node_modules", "src/components/ui/**"],
                extension: [".ts", ".tsx"],
                requireEnv: false,
            }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            "/api": "http://localhost:3000",
        },
    },
    build: {
        outDir: "dist",
    },
});
