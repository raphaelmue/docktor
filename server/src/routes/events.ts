import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {requireAuth} from "../lib/auth-middleware.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"

const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    app.get("/api/events", async (request, reply) => {
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        })
        reply.raw.write(": connected\n\n")

        const unsubscribe = stateEventBroadcaster.subscribe((event) => {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        })

        await new Promise<void>((resolve) => {
            request.raw.on("close", () => {
                unsubscribe()
                resolve()
            })
        })
    })
}

export default eventsRoutes
