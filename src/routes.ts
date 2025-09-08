import { Router } from "express";
import { RpcBundle, JsonRpcRequest } from "./models";
import { S3Uploader } from "./upload";
import config, { Config } from "./config";
import log from "./log";

const routes = Router();
const aws = new S3Uploader(config);

routes.get("/", (req, res) => {
  return res.json({ message: "Hello MEV Blocker" });
});

routes.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
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
    const bundleId = `${Number(bundle.blockNumber)}_${request.id}`;
    log.debug(`Received Bundle ${bundleId}: ${JSON.stringify(bundle)}`);

    // Context on spelling https://www.sistrix.com/ask-sistrix/technical-seo/http/http-referrer/
    const referrer: string =
      (req.headers.referrer as string) || req.headers.referer;
    res.json({
      jsonrpc: request.jsonrpc,
      id: request.id,
      result: null,
    });
    const timestamp = new Date().getTime();

    // Only upload after some delay
    setTimeout(async () => {
      try {
        log.debug(`Uploading bundle ${bundleId}`);
        await aws.upload({ bundle, bundleId, timestamp, referrer });
      } catch (e) {
        log.debug("Error", e instanceof Error ? e.stack : e);
      }
    }, (config as Config).UPLOAD_DELAY_MS);
  } catch (e) {
    log.debug("Error", e instanceof Error ? e.stack : e);
    res.status(500).send();
  }
});

export default routes;
