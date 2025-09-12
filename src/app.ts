import express from "express";
import routes from "./routes";
import promBundle from "express-prom-bundle";

class App {
  public server;

  constructor() {
    this.server = express();

    this.middlewares();
    this.routes();
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
}

export default new App().server;
