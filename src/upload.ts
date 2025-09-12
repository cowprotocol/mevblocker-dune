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
  bundle: RpcBundle;
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

  constructor(config: Config) {
    this.bucketName = config.BUCKET_NAME;
    this.externalId = config.EXTERNAL_ID;
    this.rolesToAssume = config.ROLES_TO_ASSUME.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.region = config.REGION;
  }

  public async createS3(timestamp: number) {
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
  }
  public async upload({
    bundle,
    bundleId,
    timestamp,
    referrer,
  }: UploadParams): Promise<void> {
    const duneBundle = convertBundle(bundle, bundleId, timestamp, referrer);
    const key = `raw_bundles/mevblocker_${timestamp}`;
    const body = JSON.stringify(duneBundle);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!this.s3) {
          await this.createS3(timestamp);
        }
        const client = this.s3;
        if (!client) {
          // Defensive: createS3 should set this.s3; if not, we cannot proceed.
          throw new Error("S3 client not initialized");
        }
        const params = {
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ACL: ObjectCannedACL.bucket_owner_full_control,
        };
        log.debug(
          `Uploading to s3://${this.bucketName}/${key} (attempt ${attempt})`
        );
        const res = await new Upload({ client, params }).done();
        log.debug(`Uploaded ${key} -> ${res.Location}`);
        return;
      } catch (error) {
        log.error(
          `Upload failed for ${key} (attempt ${attempt}/${maxAttempts}): ${error}`
        );
        // Force re-init of the client on next attempt
        this.s3 = undefined;
        if (attempt < maxAttempts) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw error;
      }
    }
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
    transactions: bundle.txs.map((tx) =>
      decodeTx(tx, bundle.revertingTxHashes)
    ),
    referrer,
  };
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
