import { DuneBundle, DuneBundleTransaction, RpcBundle } from "./models";
import { Upload } from "@aws-sdk/lib-storage";
import { S3, ObjectCannedACL } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import { STS } from "@aws-sdk/client-sts";
import log from "./log";
import * as https from "https";
import { Config } from "./config";
import { ethers } from "ethers";

interface UploadParams {
  bundle?: RpcBundle;
  bundleId: string;
  timestamp: number;
  referrer?: string;
}

export class S3Uploader {
  private bucketName: string;
  private externalId: string;
  private rolesToAssume: Array<string>;
  private region: string;
  private s3: S3 | undefined;
  private s3CreationPromise: Promise<void> | null = null;

  constructor(config: Config) {
    this.bucketName = config.BUCKET_NAME;
    this.externalId = config.EXTERNAL_ID;
    this.rolesToAssume = config.ROLES_TO_ASSUME.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.region = config.REGION;
  }

  public async createS3(timestamp: number): Promise<void> {
    // Prevent race conditions by using a shared promise
    if (this.s3CreationPromise) {
      return this.s3CreationPromise;
    }

    this.s3CreationPromise = (async () => {
      try {
        const credentials = await assumeRoles(
          this.rolesToAssume,
          this.externalId,
          timestamp
        );
        log.debug(`Creating S3 instance`);
        this.s3 = new S3({
          credentials,
          region: this.region,
          maxAttempts: 3,
          requestHandler: new NodeHttpHandler({
            connectionTimeout: 5000,
            socketTimeout: 60000,
            httpsAgent: new https.Agent({
              keepAlive: true,
              keepAliveMsecs: 5000,
              maxSockets: 32,
              maxFreeSockets: 16,
            }),
          }),
        });
      } catch (error) {
        // Reset promise on error so next call can retry
        this.s3CreationPromise = null;
        throw error;
      }
    })();

    return this.s3CreationPromise;
  }

  public async upload(
    { bundle, bundleId, timestamp, referrer }: UploadParams,
    retryCount = 0
  ): Promise<void> {
    const maxRetries = 3;
    try {
      if (!bundle) {
        throw new Error("Bundle is required for upload");
      }
      const duneBundle = await convertBundleStreaming(
        bundle,
        bundleId,
        timestamp,
        referrer
      );

      return this.uploadProcessedBundle(duneBundle, bundleId, retryCount);
    } catch (error) {
      log.error(
        `Bundle processing failed for ${bundleId} (attempt ${retryCount + 1}/${
          maxRetries + 1
        }): ${error}`
      );

      if (retryCount < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, retryCount) * 1000;
        log.debug(`Retrying upload in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.upload(
          { bundle: bundle!, bundleId, timestamp, referrer },
          retryCount + 1
        );
      } else {
        throw error;
      }
    }
  }

  public async uploadProcessedBundle(
    duneBundle: any,
    bundleId: string,
    retryCount = 0
  ): Promise<void> {
    const maxRetries = 3;
    try {
      if (!this.s3) {
        await this.createS3(Date.now());
      }

      const client = this.s3;
      if (!client) {
        throw new Error("S3 client not initialized");
      }

      // Use streaming JSON.stringify to avoid blocking the event loop
      const bundleJson = await this.stringifyLargeObject(duneBundle);
      const params = {
        Bucket: this.bucketName,
        Key: `raw_bundles/mevblocker_${duneBundle.timestamp}`,
        Body: bundleJson,
        ACL: ObjectCannedACL.bucket_owner_full_control,
      };

      log.debug(
        `Writing bundle ${bundleId} to ${this.bucketName} (size: ${bundleJson.length} bytes)`
      );
      const res = await new Upload({
        client,
        params,
        partSize: 1024 * 1024 * 5, // 5MB parts for large uploads
        queueSize: 4, // Limit concurrent uploads
      }).done();
      log.debug(`File Uploaded successfully ${res.Location}`);

      // Clear reference to help with GC
      duneBundle.transactions = [];
    } catch (error) {
      log.error(
        `Unable to Upload bundle ${bundleId} (attempt ${retryCount + 1}/${
          maxRetries + 1
        }): ${error}`
      );

      // Reset S3 connection on certain errors
      if (this.shouldResetConnection(error)) {
        this.s3 = undefined;
        this.s3CreationPromise = null;
      }

      if (retryCount < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, retryCount) * 1000;
        log.debug(`Retrying upload in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.uploadProcessedBundle(duneBundle, bundleId, retryCount + 1);
      } else {
        throw error;
      }
    }
  }

  // Non-blocking JSON stringify for large objects
  private async stringifyLargeObject(obj: any): Promise<string> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = JSON.stringify(obj);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private shouldResetConnection(error: unknown): boolean {
    const errorString = String(error).toLowerCase();
    return (
      errorString.includes("credentials") ||
      errorString.includes("token") ||
      errorString.includes("expired") ||
      errorString.includes("network") ||
      errorString.includes("timeout")
    );
  }
}

async function assumeRoles(
  roles: Array<string>,
  ExternalId: string,
  timestamp: number
) {
  let credentials = null;
  for (const role of roles) {
    log.debug(`Assuming role ${role}`);
    const sts: STS = new STS({ credentials });
    const auth = (
      await sts.assumeRole({
        RoleArn: role,
        RoleSessionName: `mevblocker-dune-sync-${timestamp}`,
        ExternalId,
        DurationSeconds: 3600,
      })
    ).Credentials;
    credentials = {
      accessKeyId: auth.AccessKeyId,
      secretAccessKey: auth.SecretAccessKey,
      sessionToken: auth.SessionToken,
    };
  }
  return credentials;
}

export function convertBundle(
  bundle: RpcBundle,
  bundleId: string,
  timestamp: number,
  referrer?: string
): DuneBundle {
  return {
    bundleId,
    timestamp,
    blockNumber: Number(bundle.blockNumber),
    transactions: bundle.txs
      .map((tx) => tryDecodeTx(tx, bundle.revertingTxHashes))
      .filter((t): t is DuneBundleTransaction => t !== null),
    referrer,
  };
}

// Memory-efficient streaming version for large bundles
export async function convertBundleStreaming(
  bundle: RpcBundle,
  bundleId: string,
  timestamp: number,
  referrer?: string
): Promise<DuneBundle> {
  const transactions: DuneBundleTransaction[] = [];
  const batchSize = 100; // Process transactions in batches to reduce memory pressure

  // Process transactions in batches
  for (let i = 0; i < bundle.txs.length; i += batchSize) {
    const batch = bundle.txs.slice(i, i + batchSize);
    const processedBatch = batch
      .map((tx) => tryDecodeTx(tx, bundle.revertingTxHashes))
      .filter((t): t is DuneBundleTransaction => t !== null);

    transactions.push(...processedBatch);

    // Allow event loop to process other requests more frequently for large bundles
    if (i > 0 && (i % (batchSize * 5) === 0 || bundle.txs.length > 5000)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // Clear reference to original bundle data to help GC
  bundle.txs = [];

  return {
    bundleId,
    timestamp,
    blockNumber: Number(bundle.blockNumber),
    transactions,
    referrer,
  };
}

function tryDecodeTx(
  tx: string,
  revertingTxHashes?: Array<string>
): DuneBundleTransaction | null {
  try {
    return decodeTx(tx, revertingTxHashes);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`Failed to decode transaction, skipping. Reason: ${message}`);
    return null;
  }
}

function decodeTx(
  tx: string,
  revertingTxHashes?: Array<string>
): DuneBundleTransaction {
  const parsed = ethers.Transaction.from(tx);
  const mayRevert =
    revertingTxHashes !== undefined
      ? revertingTxHashes
          .map((h) => h.toLowerCase())
          .includes(parsed.hash.toLowerCase())
      : false;
  return {
    nonce: parsed.nonce,
    maxFeePerGas: parsed.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas?.toString(),
    gasPrice: parsed.gasPrice?.toString(),
    gasLimit: parsed.gasLimit.toString(),
    to: parsed.to,
    from: parsed.from,
    value: parsed.value.toString(),
    data: parsed.data,
    hash: parsed.hash,
    mayRevert,
  };
}
