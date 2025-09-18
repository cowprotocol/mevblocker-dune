import { Router } from "express";
import { RpcBundle, JsonRpcRequest } from "./models";
import { S3Uploader, convertBundleStreaming } from "./upload";
import config, { Config } from "./config";
import log, { createLogContext } from "./log";

const routes = Router();
const aws = new S3Uploader(config);

// Track active bundle processing for monitoring (no hard limit)
let activeBundleProcessing = 0;

routes.get("/", (req, res) => {
  log.info(
    "Health check requested",
    createLogContext({
      endpoint: "/",
      method: "GET",
      userAgent: req.headers["user-agent"],
    })
  );
  return res.json({ message: "Hello MEV Blocker" });
});

routes.post("/", async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);

  try {
    // Validate request body exists and is valid JSON
    if (!req.body || typeof req.body !== "object") {
      log.warn(
        "Invalid request body",
        createLogContext({
          requestId,
          bodyType: typeof req.body,
          bodyExists: !!req.body,
          contentLength: req.headers["content-length"],
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid request body",
        message: "Request body must be valid JSON",
      });
      return;
    }

    const request: JsonRpcRequest = req.body;

    // Validate basic JSON-RPC structure
    if (!request || typeof request !== "object") {
      log.warn(
        "Invalid JSON-RPC request structure",
        createLogContext({
          requestId,
          requestType: typeof request,
          hasMethod: "method" in request,
          hasParams: "params" in request,
          hasId: "id" in request,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid JSON-RPC request",
        message: "Request must be a valid JSON-RPC object",
      });
      return;
    }

    // Avoid logging entire huge payloads; log method and basic sizes only
    const initialTxCount = Array.isArray(request?.params?.[0]?.txs)
      ? request.params[0].txs.length
      : 0;
    const approxSize = Number(req.headers["content-length"]) || "unknown";

    log.info(
      "Bundle request received",
      createLogContext({
        requestId,
        method: request?.method,
        txCount: initialTxCount,
        contentLength: approxSize,
        userAgent: req.headers["user-agent"],
        referrer: req.headers.referrer || req.headers.referer,
        clientRequestId:
          req.headers["x-request-id"] ||
          req.headers["x-amz-cf-id"] ||
          req.headers["x-amzn-requestid"],
      })
    );
    if (request.method != "eth_sendBundle") {
      log.warn(
        "Unsupported method requested",
        createLogContext({
          requestId,
          method: request?.method,
          expectedMethod: "eth_sendBundle",
        })
      );
      res.status(405).send();
      return;
    }
    if (!request.params) {
      log.warn(
        "Missing request parameters",
        createLogContext({
          requestId,
          hasParams: "params" in request,
          paramsValue: request.params,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Missing parameters",
        message: "JSON-RPC request must include 'params' field",
      });
      return;
    }

    if (!Array.isArray(request.params)) {
      log.warn(
        "Invalid request parameters type",
        createLogContext({
          requestId,
          paramsType: typeof request.params,
          paramsValue: request.params,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid parameters",
        message: "Parameters must be an array",
      });
      return;
    }

    if (request.params.length !== 1) {
      log.warn(
        "Invalid request parameters length",
        createLogContext({
          requestId,
          paramsLength: request.params.length,
          expectedLength: 1,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid parameters",
        message: "Parameters array must contain exactly one bundle object",
      });
      return;
    }
    const bundle: RpcBundle = request.params[0];

    // Validate bundle object exists and is valid
    if (!bundle || typeof bundle !== "object") {
      log.warn(
        "Invalid bundle object",
        createLogContext({
          requestId,
          bundleType: typeof bundle,
          bundleExists: !!bundle,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid bundle",
        message: "Bundle must be a valid object",
      });
      return;
    }

    // Validate bundle has required fields
    if (!bundle.txs) {
      log.warn(
        "Missing bundle transactions",
        createLogContext({
          requestId,
          hasTxs: "txs" in bundle,
          hasBlockNumber: "blockNumber" in bundle,
          bundleKeys: Object.keys(bundle),
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Missing transactions",
        message: "Bundle must include 'txs' field",
      });
      return;
    }

    if (!bundle.blockNumber) {
      log.warn(
        "Missing bundle block number",
        createLogContext({
          requestId,
          hasBlockNumber: "blockNumber" in bundle,
          blockNumberValue: bundle.blockNumber,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Missing block number",
        message: "Bundle must include 'blockNumber' field",
      });
      return;
    }

    // Validate bundle structure and content
    if (!Array.isArray(bundle.txs)) {
      log.warn(
        "Invalid bundle transactions type",
        createLogContext({
          requestId,
          txsType: typeof bundle.txs,
          txsValue: bundle.txs,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid transactions",
        message: "Bundle transactions must be an array",
      });
      return;
    }

    if (bundle.txs.length === 0) {
      log.warn(
        "Empty bundle transactions",
        createLogContext({
          requestId,
          txsLength: bundle.txs.length,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Empty bundle",
        message: "Bundle must contain at least one transaction",
      });
      return;
    }
    // Validate transaction format
    const invalidTxs = bundle.txs.filter(
      (tx) => typeof tx !== "string" || !tx.startsWith("0x")
    );
    if (invalidTxs.length > 0) {
      log.warn(
        "Invalid transaction format",
        createLogContext({
          requestId,
          bundleId: `${Number(bundle.blockNumber)}_${request.id}`,
          invalidTxCount: invalidTxs.length,
          totalTxCount: bundle.txs.length,
          sampleInvalidTx: invalidTxs[0],
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid transaction format",
        message:
          "All transactions must be valid hex strings starting with '0x'",
        invalidCount: invalidTxs.length,
      });
      return;
    }

    // Enhanced validation for bundle size
    const txCount = bundle.txs.length;

    if (txCount > 50000) {
      // Increased limit to handle larger bundles while preventing abuse
      log.warn(
        "Bundle exceeds transaction limit",
        createLogContext({
          requestId,
          bundleId: `${Number(bundle.blockNumber)}_${request.id}`,
          txCount,
          maxTxs: 50000,
        })
      );
      res.status(413).json({ error: "Too many transactions", maxTxs: 50000 });
      return;
    }

    // Estimate memory usage: ~2KB per transaction on average, with some overhead
    const estimatedMemoryMB = (txCount * 2048) / (1024 * 1024);
    const maxMemoryMB = 500; // Increased limit for larger bundles
    if (estimatedMemoryMB > maxMemoryMB) {
      log.warn(
        "Bundle exceeds memory limit",
        createLogContext({
          requestId,
          bundleId: `${Number(bundle.blockNumber)}_${request.id}`,
          txCount,
          estimatedMemoryMB,
          maxMemoryMB,
        })
      );
      res.status(413).json({
        error: "Bundle too large",
        estimatedSizeMB: estimatedMemoryMB,
        maxSizeMB: maxMemoryMB,
      });
      return;
    }
    const blockNumberNum = Number(bundle.blockNumber);
    if (!Number.isFinite(blockNumberNum) || blockNumberNum < 0) {
      log.warn(
        "Invalid block number",
        createLogContext({
          requestId,
          bundleId: `${bundle.blockNumber}_${request.id}`,
          blockNumber: bundle.blockNumber,
          blockNumberType: typeof bundle.blockNumber,
          blockNumberNum,
          isFinite: Number.isFinite(blockNumberNum),
          isNegative: blockNumberNum < 0,
          clientRequestId:
            req.headers["x-request-id"] ||
            req.headers["x-amz-cf-id"] ||
            req.headers["x-amzn-requestid"],
        })
      );
      res.status(400).json({
        error: "Invalid block number",
        message: "Block number must be a valid positive number",
        received: bundle.blockNumber,
      });
      return;
    }

    const bundleId = `${blockNumberNum}_${request.id}`;
    log.info(
      "Bundle validated successfully",
      createLogContext({
        requestId,
        bundleId,
        blockNumber: bundle.blockNumber,
        txCount: bundle.txs.length,
        estimatedMemoryMB: (txCount * 2048) / (1024 * 1024),
      })
    );

    // Log high concurrency for monitoring but don't block requests
    if (activeBundleProcessing > 100) {
      log.warn(
        "High concurrent bundle processing",
        createLogContext({
          requestId,
          bundleId,
          activeBundleProcessing,
          threshold: 100,
        })
      );
    }

    // Only reject requests if we're in extreme memory pressure (very high concurrency)
    if (activeBundleProcessing > 500) {
      log.error(
        "Extreme concurrent bundle processing - rejecting request",
        createLogContext({
          requestId,
          bundleId,
          activeBundleProcessing,
          threshold: 500,
          processingTime: Date.now() - requestStartTime,
        })
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

    const responseTime = Date.now() - requestStartTime;
    log.info(
      "Bundle request processed successfully",
      createLogContext({
        requestId,
        bundleId,
        responseTime,
        referrer,
      })
    );

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
      const processingStartTime = Date.now();
      try {
        log.debug(
          "Starting bundle conversion",
          createLogContext({
            requestId,
            bundleId,
            txCount: bundle.txs.length,
          })
        );

        // Convert bundle immediately to release original bundle memory
        const duneBundle = await convertBundleStreaming(
          bundle,
          bundleId,
          timestamp,
          referrer
        );

        const conversionTime = Date.now() - processingStartTime;
        log.info(
          "Bundle conversion completed",
          createLogContext({
            requestId,
            bundleId,
            conversionTime,
            processedTxCount: duneBundle.transactions.length,
          })
        );

        // Clear original bundle reference immediately
        delete uploadParams.bundle;

        // Schedule actual upload after delay with pre-processed data
        setTimeout(async () => {
          const uploadStartTime = Date.now();
          try {
            log.info(
              "Starting bundle upload",
              createLogContext({
                requestId,
                bundleId,
                delay: (config as Config).UPLOAD_DELAY_MS,
              })
            );

            await aws.uploadProcessedBundle(duneBundle, bundleId);

            const uploadTime = Date.now() - uploadStartTime;
            const totalProcessingTime = Date.now() - requestStartTime;
            log.info(
              "Bundle upload completed successfully",
              createLogContext({
                requestId,
                bundleId,
                uploadTime,
                totalProcessingTime,
                activeBundleProcessing: activeBundleProcessing - 1,
              })
            );
          } catch (e) {
            const uploadTime = Date.now() - uploadStartTime;
            log.error(
              "Bundle upload failed",
              createLogContext({
                requestId,
                bundleId,
                uploadTime,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
              })
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

        const processingTime = Date.now() - processingStartTime;
        log.error(
          "Bundle processing failed",
          createLogContext({
            requestId,
            bundleId,
            processingTime,
            activeBundleProcessing,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          })
        );
      }
    });
  } catch (e) {
    const totalTime = Date.now() - requestStartTime;
    log.error(
      "Request processing failed",
      createLogContext({
        requestId,
        totalTime,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      })
    );
    res.status(500).send();
  }
});

export default routes;
