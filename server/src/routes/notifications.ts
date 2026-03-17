import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {requireAuth} from "../lib/auth-middleware.js"
import {notificationRepository} from "../repositories/notification-repository.js"

const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    app.get("/api/notifications", async () => {
        return notificationRepository.findRecent(100)
    })
}

export default notificationRoutes
