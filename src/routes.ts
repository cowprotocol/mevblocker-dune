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
    const clientRequestId =
      req.headers["x-request-id"] || req.headers["x-amz-cf-id"];

    log.trace(
      `Handling incoming request: ${request?.method}, clientRequestId: ${clientRequestId}`
    );

    if (request.method != "eth_sendBundle") {
      log.debug("unsupported method");
      res.status(405).send();
      return;
    }
    if (!Array.isArray(request.params) || request.params.length != 1) {
      log.warn(
        `Invalid params: ${typeof request.params}, length: ${
          request.params?.length
        }, clientRequestId: ${clientRequestId}`
      );
      res
        .status(400)
        .json({
          error: "Invalid parameters",
          message: "Expected single bundle parameter",
        });
      return;
    }
    const bundle: RpcBundle = request.params[0];

    // Basic bundle validation
    if (!bundle || !Array.isArray(bundle.txs) || bundle.txs.length === 0) {
      log.warn(`Invalid bundle structure, clientRequestId: ${clientRequestId}`);
      res
        .status(400)
        .json({
          error: "Invalid bundle",
          message: "Bundle must contain transactions",
        });
      return;
    }

    const bundleId = `${Number(bundle.blockNumber)}_${request.id}`;
    const txCount = bundle.txs.length;
    log.debug(
      `Received Bundle ${bundleId} (block=${bundle.blockNumber}, txs=${txCount}), clientRequestId: ${clientRequestId}`
    );

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
        log.error(
          `Upload failed for bundle ${bundleId}, clientRequestId: ${clientRequestId}:`,
          e instanceof Error ? e.stack : e
        );
      }
    }, (config as Config).UPLOAD_DELAY_MS);
  } catch (e) {
    log.error(
      `Request processing error, clientRequestId: ${clientRequestId}:`,
      e instanceof Error ? e.stack : e
    );
    res.status(500).send();
  }
});

export default routes;
