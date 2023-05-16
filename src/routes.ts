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
      log.debug("unsupported method");
      res.status(405).send();
      return;
    }
    if (request.params.length != 1) {
      log.warn("expecting a single bundle");
      res.status(400).send();
      return;
    }
    const bundle: RpcBundle = request.params[0];
    log.debug(`Received Bundle: ${JSON.stringify(bundle)}`);

    const bundleId = `${Number(bundle.blockNumber)}_${request.id}`;
    // Context on spelling https://www.sistrix.com/ask-sistrix/technical-seo/http/http-referrer/
    const referrer: string =
      req.headers.referer || (req.headers.referrer as string);
    await aws.upload(bundle, bundleId, referrer);

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
