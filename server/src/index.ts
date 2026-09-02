import {buildApp} from "./app.js";
import {assertStacksDirMatchesHost} from "./lib/stacks-dir.js";

const app = await buildApp();

try {
    assertStacksDirMatchesHost();
} catch (err) {
    app.log.error(err);
    process.exit(1);
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
    await app.listen({port, host});
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
