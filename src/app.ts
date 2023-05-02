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
    this.server.use(express.json());
    this.server.use(
      promBundle({
        includeMethod: true,
        includePath: true,
        includeStatusCode: true,
      })
    );
  }

  routes() {
    this.server.use(routes);
  }
}

export default new App().server;
