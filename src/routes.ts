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

routes.post("/", async (req, res) => {
  try {
    const request: JsonRpcRequest = req.body;
    // Avoid logging entire huge payloads; log method and basic sizes only
    const txCount = Array.isArray(request?.params?.[0]?.txs)
      ? request.params[0].txs.length
      : 0;
    const approxSize = Number(req.headers["content-length"]) || "unknown";
    log.trace(
      `Handling incoming request: method=${request?.method} txCount=${txCount} contentLength=${approxSize}`
    );
    if (request.method != "eth_sendBundle") {
      log.debug("unsupported method");
      res.status(405).send();
      return;
    }
    if (!Array.isArray(request.params) || request.params.length != 1) {
      log.warn("expecting a single bundle");
      res.status(400).send();
      return;
    }
    const bundle: RpcBundle = request.params[0];
    
    // Validate bundle structure and content
    if (!Array.isArray(bundle.txs) || bundle.txs.length === 0) {
      log.warn("bundle.txs must be a non-empty array");
      res.status(400).send();
      return;
    }
    if (bundle.txs.length > 5000) {
      // sanity limit to prevent abuse / memory pressure
      log.warn(`too many txs in bundle: ${bundle.txs.length}`);
      res.status(413).send();
      return;
    }
    const blockNumberNum = Number(bundle.blockNumber);
    if (!Number.isFinite(blockNumberNum)) {
      log.warn(`invalid blockNumber: ${bundle.blockNumber}`);
      res.status(400).send();
      return;
    }
    
    const bundleId = `${blockNumberNum}_${request.id}`;
    log.debug(`Received Bundle ${bundleId} (block=${bundle.blockNumber}, txs=${bundle.txs.length})`);

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
