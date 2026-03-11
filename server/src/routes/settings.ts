import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {z} from "zod"
import {requireAuth} from "../lib/auth-middleware.js"
import {settingsService} from "../application/index.js"

const updateGeneralSettingsSchema = z.object({
    instanceName: z.string().optional(),
    baseUrl: z.string().optional(),
    timezone: z.string().optional(),
})

const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    app.get("/api/settings/general", async () => {
        return settingsService.getGeneralSettings()
    })

    app.put(
        "/api/settings/general",
        {schema: {body: updateGeneralSettingsSchema}},
        async (request) => {
            return settingsService.updateGeneralSettings(request.body)
        },
    )
}

export default settingsRoutes
