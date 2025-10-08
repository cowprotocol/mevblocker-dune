Mev Blocker Dune

A web-service which implements the PBS builder API to receive MEV Blocker bundles and forwards them into Dune's community sources.

## Configuration

Export the following environment variables ([`./src/config.ts`](./src/config.ts)):

- BUCKET_NAME: The AWS bucket to upload bundles to
- REGION: The AWS region of the bucket
- ROLES_TO_ASSUME: comma separated list of roles to assume in order to upload data
- EXTERNAL_ID: Unique identifier needed to assume roles

## Run

```
yarn
yarn start:dev
```

## Testing

Choose a test transaction hash, get the RLP-encoded signed transaction (the hex blob) for that hash, e.g. via https://etherscan.io/getRawTx?tx=<tx_hash>.

Then, put that blob into the txs field of the bundle, e.g.

```
curl -sL --data '{"jsonrpc": "2.0","id": "42069","method": "eth_sendBundle","params": [{"txs": ["0x02f8b10181db8459682f00850c9f5014d282be9894a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4880b844a9059cbb0000000000000000000000005408b27504dfcf7b0c3edf116e847aa19ce7f03c0000000000000000000000000000000000000000000000000000001e449a9400c080a049c0f50df4219481e031ac35816946daef9d08004f3324f7f46f6938488025aba02a4bda81f792bc5b7033804e39b7e55e619e56de1afcddd2ae4943ae5e7737c4"],"blockNumber": "0xf79d4e","refundPercent": 99,"refundRecipient": "0xab5801a7d398351b8be11c439e05c5b3259aec9b"}]}' -H "Content-Type: application/json" -H "referer: foobar" -X POST localhost:8080
```

and observe logs. Actual uploads can only be tested in the allow listed AWS cluster.
