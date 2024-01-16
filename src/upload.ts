import { DuneBundle, DuneBundleTransaction, RpcBundle } from "./models";
import { S3, STS } from "aws-sdk";
import log from "./log";
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
  private s3: S3;

  constructor(config: Config) {
    this.bucketName = config.BUCKET_NAME;
    this.externalId = config.EXTERNAL_ID;
    this.rolesToAssume = config.ROLES_TO_ASSUME.split(",");
  }

  public async createS3(timestamp: number) {
    const credentials = await assumeRoles(
      this.rolesToAssume,
      this.externalId,
      timestamp
    );
    log.debug(`Creating S3 instance`);
    this.s3 = new S3(credentials);
  }
  public async upload({ bundle, bundleId, timestamp, referrer }: UploadParams) {
    const duneBundle = convertBundle(bundle, bundleId, timestamp, referrer);
    let retry = false;
    try {
      if (!this.s3) {
        await this.createS3(timestamp);
      } else {
        // if we are using a cached s3 instance we may want to retry in case of failure
        retry = true;
      }
      const params = {
        Bucket: this.bucketName,
        Key: `raw_bundles/mevblocker_${timestamp}`,
        Body: JSON.stringify(duneBundle),
        ACL: "bucket-owner-full-control",
      };
      log.debug(
        `Writing log to ${this.bucketName}: ${JSON.stringify(duneBundle)}`
      );
      const res = await this.s3.upload(params).promise();
      log.debug(`File Uploaded successfully ${res.Location}`);
    } catch (error) {
      log.error(`Unable to Upload the file: ${error}, retrying: ${retry}`);
      // Make sure we re-initialize the connection next time
      this.s3 = undefined;
      if (retry) {
        this.upload({ bundle, bundleId, timestamp, referrer });
      } else {
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
      await sts
        .assumeRole({
          RoleArn: role,
          RoleSessionName: `mevblocker-dune-sync-${timestamp}`,
          ExternalId,
        })
        .promise()
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
  const parsed = ethers.utils.parseTransaction(tx);
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
