import {defineConfig} from "prisma/config";
import * as path from "node:path";

export default defineConfig({
    schema: path.join(__dirname, "schema"),
    migrations: {
        path: path.join(__dirname, "migrations")
    },
    datasource: {
        url: process.env.DATABASE_URL
    }
});
