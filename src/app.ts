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

    log.info("Application initialized");
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
    this.server.use(express.json({ limit: "50mb" }));
  }

  routes() {
    this.server.use(routes);
  }
}

export default new App().server;
