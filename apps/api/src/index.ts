import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

const port = Number(process.env.DOCKTOR_PORT) || 3001;
const host = process.env.DOCKTOR_HOST || "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors);
await app.register(cookie);

app.get("/health", async () => {
  return { status: "ok" };
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
