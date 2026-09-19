import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import multipart from "@fastify/multipart";
import {z} from "zod";
import {createCertificateSchema} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import {certificateService} from "../application/index.js";
import {BadRequestError} from "../lib/errors.js";

// Certificates and keys are small PEM text — anything larger than this is
// not a certificate, and this limit is the denial-of-service mitigation
// (T-09-32) for this route's file-upload surface.
export const CERT_UPLOAD_MAX_BYTES = 64 * 1024;

// @fastify/multipart's own codes for exceeding any of the three limits
// configured below (fileSize, files, fields) — all three are reachable from
// the same limits config and all three carry a real statusCode: 413 on the
// underlying error, so all three must be mapped, not just the file-size one.
//
// FST_FILES_LIMIT and FST_FIELDS_LIMIT are the codes @fastify/multipart's own
// event handlers construct, but empirically (verified against the installed
// @fastify/multipart + @fastify/busboy versions) that error races the
// currently-awaited `part.toBuffer()` call for the *previous*, within-limit
// part: busboy's `cleanup()` calls `request.unpipe(bb)` before the file
// stream this route is already awaiting has finished, so the error actually
// observed by the `for await` loop below is Node's own
// ERR_STREAM_PREMATURE_CLOSE, not the multipart-specific code. Both are
// mapped so this route degrades gracefully regardless of which one a given
// runtime/timing produces.
const MULTIPART_LIMIT_CODES = new Set([
    "FST_REQ_FILE_TOO_LARGE",
    "FST_FILES_LIMIT",
    "FST_FIELDS_LIMIT",
    "ERR_STREAM_PREMATURE_CLOSE",
]);

const certificateParamsSchema = z.object({id: z.string()});

const certificateRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth);

    // Registered inside this plugin (encapsulated) so no other route's body
    // parsing changes.
    await app.register(multipart, {
        limits: {fileSize: CERT_UPLOAD_MAX_BYTES, files: 3, fields: 2},
    });

    app.get("/api/certificates", async () => {
        return certificateService.listAll();
    });

    app.post("/api/certificates", async (request, reply) => {
        const fields: Record<string, string> = {};
        const files: Record<string, Buffer> = {};

        try {
            for await (const part of request.parts()) {
                if (part.type === "file") {
                    files[part.fieldname] = await part.toBuffer();
                } else {
                    fields[part.fieldname] = String(part.value);
                }
            }
        } catch (err) {
            // server/src/app.ts's global error handler only maps AppError
            // subclasses, Zod validation errors, and error.name === "ZodError"
            // to a client-facing status — any other error (including these,
            // which @fastify/multipart gives a real statusCode: 413) falls
            // through to a generic 500. Mapped explicitly here so an
            // over-limit upload is a 4xx, not an unhandled-looking 500.
            if (err && typeof err === "object" && "code" in err && MULTIPART_LIMIT_CODES.has(err.code as string)) {
                throw new BadRequestError(
                    "Certificate upload exceeded an upload limit (file size, file count, or field count)",
                );
            }
            throw err;
        }

        // A multipart body cannot use the {schema: {body: zodSchema}}
        // JSON-body mechanism the other routes use, so domainPattern is
        // validated here, explicitly, before the service is ever called.
        const parsedInput = createCertificateSchema.safeParse({domainPattern: fields.domainPattern});
        if (!parsedInput.success) {
            throw new BadRequestError(
                parsedInput.error.issues[0]?.message ?? "domainPattern is invalid",
            );
        }

        if (!files.certificate) {
            throw new BadRequestError("Missing required certificate file part");
        }
        if (!files.privateKey) {
            throw new BadRequestError("Missing required privateKey file part");
        }

        const created = await certificateService.create({
            domainPattern: parsedInput.data.domainPattern,
            certificatePem: files.certificate.toString("utf-8"),
            privateKeyPem: files.privateKey.toString("utf-8"),
            caBundlePem: files.caBundle ? files.caBundle.toString("utf-8") : null,
        });

        return reply.status(201).send(created);
    });

    app.delete(
        "/api/certificates/:id",
        {schema: {params: certificateParamsSchema}},
        async (request, reply) => {
            await certificateService.delete(request.params.id);
            return reply.status(204).send();
        },
    );
};

export default certificateRoutes;
