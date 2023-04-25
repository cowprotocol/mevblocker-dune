import express from "express";
import routes from "./routes";

function configure_middlewares(server) {
  server.use(express.json());
}

function configure_routes(server) {
  server.use(routes);
}

const server = express();
configure_middlewares(server);
configure_routes(server);

export default server;
