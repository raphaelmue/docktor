import {betterAuth} from "better-auth";
import {prismaAdapter} from "better-auth/adapters/prisma";
import {prisma} from "./db.js";

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: process.env.BETTER_AUTH_URL
        ? [process.env.BETTER_AUTH_URL]
        : ["http://localhost:5173"],
    emailAndPassword: {
        enabled: true,
    },
});
