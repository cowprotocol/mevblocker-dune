import { Router } from "express";
import { RpcBundle, JsonRpcRequest } from "./models";
import { S3Uploader } from "./upload";
import config, { Config } from "./config";
import log from "./log";
import memoryMonitor from "./memory-monitor";

const routes = Router();
const aws = new S3Uploader(config);

routes.get("/", (req, res) => {
  return res.json({ message: "Hello MEV Blocker" });
});

routes.post("/", async (req, res) => {
  try {
    const request: JsonRpcRequest = req.body;
    // Avoid logging entire huge payloads; log method and basic sizes only
    const initialTxCount = Array.isArray(request?.params?.[0]?.txs)
      ? request.params[0].txs.length
      : 0;
    const approxSize = Number(req.headers["content-length"]) || "unknown";
    log.trace(
      `Handling incoming request: method=${request?.method} txCount=${initialTxCount} contentLength=${approxSize}`
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
    // Enhanced validation for bundle size
    const txCount = bundle.txs.length;

    if (txCount > 10000) {
      // Increased limit but still reasonable to prevent abuse
      log.warn(`too many txs in bundle: ${txCount}`);
      res.status(413).json({ error: "Too many transactions", maxTxs: 10000 });
      return;
    }

    // Estimate memory usage: ~2KB per transaction on average
    const estimatedMemoryMB = (txCount * 2048) / (1024 * 1024);
    if (estimatedMemoryMB > 100) {
      log.warn(
        `Bundle too large: ${txCount} txs, estimated ${estimatedMemoryMB}MB`
      );
      res.status(413).json({
        error: "Bundle too large",
        estimatedSizeMB: estimatedMemoryMB,
      });
      return;
    }
    const blockNumberNum = Number(bundle.blockNumber);
    if (!Number.isFinite(blockNumberNum)) {
      log.warn(`invalid blockNumber: ${bundle.blockNumber}`);
      res.status(400).send();
      return;
    }

    const bundleId = `${blockNumberNum}_${request.id}`;
    log.debug(
      `Received Bundle ${bundleId} (block=${bundle.blockNumber}, txs=${bundle.txs.length})`
    );

    // Log memory stats for large bundles
    if (bundle.txs.length > 1000) {
      memoryMonitor.logMemoryStats();
    }

    // Context on spelling https://www.sistrix.com/ask-sistrix/technical-seo/http/http-referrer/
    const referrer: string =
      (req.headers.referrer as string) || req.headers.referer;
    res.json({
      jsonrpc: request.jsonrpc,
      id: request.id,
      result: null,
    });
    const timestamp = new Date().getTime();

    // Create upload parameters to avoid holding bundle reference in closure
    const uploadParams = { bundle, bundleId, timestamp, referrer };

    // Only upload after some delay - use process.nextTick for better memory management
    setTimeout(() => {
      // Use setImmediate to avoid blocking the event loop
      setImmediate(async () => {
        try {
          log.debug(`Uploading bundle ${bundleId}`);
          await aws.upload(uploadParams);
          // Clear reference to help GC
          uploadParams.bundle = null as unknown as RpcBundle;
        } catch (e) {
          log.error(
            `Upload failed for bundle ${bundleId}:`,
            e instanceof Error ? e.stack : e
          );
          // Clear reference even on error
          uploadParams.bundle = null as unknown as RpcBundle;
        }
      });
    }, (config as Config).UPLOAD_DELAY_MS);
  } catch (e) {
    log.debug("Error", e instanceof Error ? e.stack : e);
    res.status(500).send();
  }
});

export default routes;
