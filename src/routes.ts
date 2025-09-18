import { Router } from "express";
import { RpcBundle, JsonRpcRequest } from "./models";
import { S3Uploader, convertBundleStreaming } from "./upload";
import config, { Config } from "./config";
import log from "./log";

const routes = Router();
const aws = new S3Uploader(config);

// Track active bundle processing for monitoring (no hard limit)
let activeBundleProcessing = 0;

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


    // Log high concurrency for monitoring but don't block requests
    if (activeBundleProcessing > 100) {
      log.warn(
        `High concurrent bundle processing: ${activeBundleProcessing} active bundles`
      );
    }
    
    // Only reject requests if we're in extreme memory pressure (very high concurrency)
    if (activeBundleProcessing > 500) {
      log.error(
        `Extreme concurrent bundle processing: ${activeBundleProcessing} active bundles, rejecting request`
      );
      res.status(503).json({
        error: "Service temporarily unavailable",
        message: "Server is under extreme load, please retry later",
      });
      return;
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

    // Schedule upload with immediate memory cleanup to prevent accumulation
    const uploadParams = { bundle, bundleId, timestamp, referrer };
    
    // Increment active processing counter for monitoring
    activeBundleProcessing++;
    
    // Process bundle asynchronously to avoid blocking the response
    setImmediate(async () => {
      try {
        // Convert bundle immediately to release original bundle memory
        const duneBundle = await convertBundleStreaming(bundle, bundleId, timestamp, referrer);
        
        // Clear original bundle reference immediately
        delete uploadParams.bundle;
        
        // Schedule actual upload after delay with pre-processed data
        setTimeout(async () => {
          try {
            log.debug(`Uploading bundle ${bundleId}`);
            await aws.uploadProcessedBundle(duneBundle, bundleId);
          } catch (e) {
            log.error(
              `Upload failed for bundle ${bundleId}:`,
              e instanceof Error ? e.stack : e
            );
          } finally {
            // Clear processed bundle reference and decrement counter
            duneBundle.transactions = [];
            activeBundleProcessing--;
            
            // Trigger GC periodically to help with memory management
            if (activeBundleProcessing % 20 === 0 && global.gc) {
              global.gc();
            }
          }
        }, (config as Config).UPLOAD_DELAY_MS);
      } catch (e) {
        log.error(
          `Bundle processing failed for ${bundleId}:`,
          e instanceof Error ? e.stack : e
        );
        // Clear reference on error and decrement counter
        delete uploadParams.bundle;
        activeBundleProcessing--;
        
        // Log error for monitoring
        log.error(`Bundle processing failed, active count: ${activeBundleProcessing}`);
      }
    });
  } catch (e) {
    log.debug("Error", e instanceof Error ? e.stack : e);
    res.status(500).send();
  }
});

export default routes;
