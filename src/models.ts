export interface JsonRpcRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: Array<RpcBundle>;
}

export interface RpcBundle {
  txs: Array<string>;
  blockNumber: string;
}

export interface DuneBundleTransaction {
  nonce: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  gasLimit: string;
  to: string;
  from: string;
  value: string;
  data: string;
  hash: string;
}

export interface DuneBundle {
  bundleId: string;
  timestamp: number;
  blockNumber: number;
  transactions: Array<DuneBundleTransaction>;
}
