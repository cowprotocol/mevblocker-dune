import express from "express";
import routes from "./routes";
import promBundle from "express-prom-bundle";
import log from "./log";
import memoryMonitor from "./memory-monitor";

class App {
  public server;

  constructor() {
    this.server = express();

    this.middlewares();
    this.routes();
    this.errorHandlers();

    // Start memory monitoring
    memoryMonitor.startMonitoring(30000); // Check every 30 seconds
    log.info("Application initialized with memory monitoring");
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
    // Increase payload limit to handle large bundles (up to 50MB)
    // This allows for bundles with thousands of transactions
    this.server.use(
      express.json({
        limit: "50mb",
        // Add memory-efficient parsing options
        strict: true,
        type: "application/json",
      })
    );
  }

  routes() {
    this.server.use(routes);
  }

  errorHandlers() {
    // Handle body parser and request stream errors (e.g., entity too large, aborted request)
    this.server.use(
      (
        err: Error & { type?: string; code?: string },
        req: express.Request,
        res: express.Response
      ) => {
        const contentLength = req.headers["content-length"] || "unknown";
        const errType = err?.type || "";
        const errCode = err?.code || "";
        const message = err?.message || "";

        if (errType === "entity.too.large") {
          log.warn(`Payload too large: content-length=${contentLength}`);
          return res
            .status(413)
            .json({ error: "Payload too large", maxSize: "50MB" });
        }
        if (
          message === "request aborted" ||
          errType === "request.aborted" ||
          errCode === "ECONNABORTED"
        ) {
          log.warn(
            `Request aborted by client: content-length=${contentLength}`
          );
          return res.status(400).json({ error: "Request aborted" });
        }

        // Handle memory-related errors
        if (
          message.includes("out of memory") ||
          message.includes("Maximum call stack") ||
          errCode === "ERR_OUT_OF_MEMORY"
        ) {
          log.error(
            `Memory error: ${message}, content-length=${contentLength}`
          );
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
          return res.status(507).json({
            error: "Insufficient storage",
            message: "Bundle too large to process",
          });
        }

        log.error(`Unhandled error: ${message || err}`);
        return res.status(500).json({ error: "Internal server error" });
      }
    );
  }
}

export default new App().server;
