import express from "express";
import routes from "./routes";
import promBundle from "express-prom-bundle";
import log from "./log";

class App {
  public server;

  constructor() {
    this.server = express();

    this.middlewares();
    this.routes();
    this.errorHandlers();
  }

  middlewares() {
    this.server.use(
      promBundle({
        includeMethod: true,
        includePath: true,
        includeStatusCode: true,
        httpDurationMetricName: "mevblocker_dune_http_request",
      })
    );
    this.server.use(express.json({ limit: "10mb" }));
  }

  routes() {
    this.server.use(routes);
  }

  errorHandlers() {
    // Handle body parser and request stream errors (e.g., entity too large, aborted request)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.server.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const contentLength = req.headers["content-length"] || "unknown";
      const errType = err?.type || "";
      const errCode = err?.code || "";
      const message = err?.message || "";

      if (errType === "entity.too.large") {
        log.warn(`Payload too large: content-length=${contentLength}`);
        return res.status(413).send();
      }
      if (message === "request aborted" || errType === "request.aborted" || errCode === "ECONNABORTED") {
        log.warn(`Request aborted by client: content-length=${contentLength}`);
        return res.status(400).send();
      }

      log.error(`Unhandled error: ${message || err}`);
      return res.status(500).send();
    });
  }
}

export default new App().server;
