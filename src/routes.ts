import { Router } from "express";
import { RpcBundle, JsonRpcRequest } from "./models";
import { S3Uploader } from "./upload";
import config from "./config";
import log from "./log";

const routes = Router();
const aws = new S3Uploader(config);

routes.get("/", (req, res) => {
  return res.json({ message: "Hello MEV Blocker" });
});

routes.post("/", async (req, res) => {
  try {
    const request: JsonRpcRequest = req.body;
    log.trace(`Handling incoming request: ${JSON.stringify(request)}`);
    if (request.method != "eth_sendBundle") {
      throw "unsupported method";
    }
    if (request.params.length != 1) {
      throw "expecting a single bundle";
    }
    const bundle: RpcBundle = request.params[0];
    log.debug(`Received Bundle: ${JSON.stringify(bundle)}`);

    const bundleId = `${Number(bundle.blockNumber)}_${request.id}`;
    await aws.upload(bundle, bundleId);

    res.json({
      jsonrpc: request.jsonrpc,
      id: request.id,
      result: null,
    });
  } catch (e) {
    log.debug(e);
    res.status(500).send();
  }
});

export default routes;
