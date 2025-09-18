import express from "express";
import routes from "./routes";
import promBundle from "express-prom-bundle";
import log, { createLogContext } from "./log";

class App {
  public server;

  constructor() {
    this.server = express();

    this.middlewares();
    this.routes();
    this.errorHandlers();

    log.info(
      "Application initialized",
      createLogContext({
        port: 8080,
        environment: process.env.NODE_ENV || "development",
      })
    );
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
    // Increase payload limit to handle large bundles (up to 200MB)
    // This allows for bundles with tens of thousands of transactions
    this.server.use(
      express.json({
        limit: "200mb",
        strict: true,
        type: "application/json",
      })
    );

    // Add middleware to catch JSON parsing errors
    this.server.use(
      (
        err: Error & { status?: number },
        req: express.Request,
        res: express.Response
      ) => {
        if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
          log.warn(
            "JSON parsing error",
            createLogContext({
              error: err.message,
              contentLength: req.headers["content-length"],
              contentType: req.headers["content-type"],
              userAgent: req.headers["user-agent"],
              clientRequestId:
                req.headers["x-request-id"] ||
                req.headers["x-amz-cf-id"] ||
                req.headers["x-amzn-requestid"],
            })
          );
          return res.status(400).json({
            error: "Invalid JSON",
            message: "Request body must be valid JSON",
          });
        }
      }
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
          log.warn(
            "Payload too large",
            createLogContext({
              contentLength,
              maxSize: "200MB",
              userAgent: req.headers["user-agent"],
              clientRequestId:
                req.headers["x-request-id"] ||
                req.headers["x-amz-cf-id"] ||
                req.headers["x-amzn-requestid"],
            })
          );
          return res
            .status(413)
            .json({ error: "Payload too large", maxSize: "200MB" });
        }
        if (
          message === "request aborted" ||
          errType === "request.aborted" ||
          errCode === "ECONNABORTED"
        ) {
          log.warn(
            "Request aborted by client",
            createLogContext({
              contentLength,
              userAgent: req.headers["user-agent"],
              errorType: errType,
              errorCode: errCode,
              clientRequestId:
                req.headers["x-request-id"] ||
                req.headers["x-amz-cf-id"] ||
                req.headers["x-amzn-requestid"],
            })
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
            "Memory error",
            createLogContext({
              message,
              contentLength,
              errorCode: errCode,
              userAgent: req.headers["user-agent"],
              clientRequestId:
                req.headers["x-request-id"] ||
                req.headers["x-amz-cf-id"] ||
                req.headers["x-amzn-requestid"],
            })
          );
          return res.status(507).json({
            error: "Insufficient storage",
            message: "Bundle too large to process",
          });
        }

        log.error(
          "Unhandled error",
          createLogContext({
            message: message || String(err),
            errorType: errType,
            errorCode: errCode,
            contentLength,
            userAgent: req.headers["user-agent"],
            stack: err instanceof Error ? err.stack : undefined,
            clientRequestId:
              req.headers["x-request-id"] ||
              req.headers["x-amz-cf-id"] ||
              req.headers["x-amzn-requestid"],
          })
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    );
  }
}

export default new App().server;
