import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "../generated/prisma/client.js";

let _prisma: PrismaClient | undefined;

export const prisma = new Proxy({} as PrismaClient, {
    get(_target, prop, receiver) {
        if (!_prisma) {
            const connectionString = process.env.DATABASE_URL;
            if (!connectionString) {
                throw new Error("DATABASE_URL environment variable is required");
            }
            const adapter = new PrismaPg({connectionString});
            _prisma = new PrismaClient({adapter});
        }
        return Reflect.get(_prisma, prop, receiver);
    },
});
