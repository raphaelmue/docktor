import type {FastifyReply, FastifyRequest} from "fastify";
import type {Session, User} from "better-auth";
import {auth} from "./auth.js";
import {fromNodeHeaders} from "better-auth/node";

declare module "fastify" {
    interface FastifyRequest {
        session: Session;
        user: User;
    }
}

export async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
) {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
        return reply.status(401).send({error: "Unauthorized"});
    }

    request.session = session.session;
    request.user = session.user;
}
