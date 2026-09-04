import {betterAuth} from "better-auth";
import {prismaAdapter} from "better-auth/adapters/prisma";
import {APIError, createAuthMiddleware} from "better-auth/api";
import {prisma} from "./db.js";

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.BETTER_AUTH_URL
        ? [process.env.BETTER_AUTH_URL]
        : ["http://localhost:5173"],
    emailAndPassword: {
        enabled: true,
    },
    hooks: {
        // T-05-09/CR-01: self-registration via better-auth's own
        // sign-up-email endpoint must be blocked once at least one user
        // exists. Only the onboarding wizard's own step1
        // (routes/setup.ts, which calls this same signUpEmail API
        // internally to create the very first admin) may create a user
        // when the instance is empty. Scoped to this single path via
        // `ctx.path` so login/session/every other auth route is
        // unaffected.
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== "/sign-up/email") return;

            const userCount = await prisma.user.count();
            if (userCount > 0) {
                throw new APIError("FORBIDDEN", {
                    message: "Self-registration is disabled; setup has already been completed",
                });
            }
        }),
    },
});
