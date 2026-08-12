require("dotenv").config();
const algosdk = require("algosdk");

const ALGOD_SERVER = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const ALGOD_PORT = process.env.ALGOD_PORT || "";
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || "";

const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

function getAddressString(addrObj) {
  if (typeof addrObj === "string") return addrObj;
  if (addrObj && typeof addrObj.toString === "function") {
    const s = addrObj.toString();
    if (s && s !== "[object Object]") return s;
  }
  if (addrObj && addrObj.publicKey) {
    return algosdk.encodeAddress(addrObj.publicKey);
  }
  return String(addrObj);
}

/**
 * Record a verification on the Algorand TestNet Smart Contract.
 * 
 * @param {string} hash - SHA-256 hash of the news article
 * @param {string} prediction - REAL or FAKE prediction
 * @param {string} timestamp - ISO / formatted timestamp
 * @returns {Promise<{ success: boolean, transactionId: string, timestamp: string }>}
 */
async function recordVerificationOnChain(hash, prediction, timestamp) {
  const appId = parseInt(process.env.APP_ID, 10);
  if (!appId || isNaN(appId)) {
    throw new Error("APP_ID environment variable is missing or invalid. Run node deploy.js first.");
  }

  const mnemonic = process.env.REPORTER_MNEMONIC;
  if (!mnemonic) {
    throw new Error("REPORTER_MNEMONIC environment variable is missing.");
  }

  const reporterAccount = algosdk.mnemonicToSecretKey(mnemonic);
  const reporterAddrStr = getAddressString(reporterAccount.addr);

  const suggestedParams = await algodClient.getTransactionParams().do();

  // ABI Method: store_verification(string,string,string)string
  // Selector: 0x8608a636
  const methodSelector = Buffer.from([0x86, 0x08, 0xa6, 0x36]);

  // Encode ABI string arguments (length-prefixed string)
  const encodeAbiString = (str) => {
    const buf = Buffer.from(str, "utf8");
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(buf.length, 0);
    return Buffer.concat([lenBuf, buf]);
  };

  const arg1 = encodeAbiString(hash);
  const arg2 = encodeAbiString(prediction);
  const arg3 = encodeAbiString(timestamp);

  const appArgs = [methodSelector, arg1, arg2, arg3];

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    from: reporterAddrStr,
    suggestedParams,
    appIndex: appId,
    appArgs,
  });

  const signedTxn = appCallTxn.signTxn(reporterAccount.sk);
  console.log(`[BLOCKCHAIN] Submitting smart contract call for hash ${hash.slice(0, 10)}...`);

  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txId || sendResult.txid || sendResult;
  console.log(`[BLOCKCHAIN] TxId: ${txId}. Waiting for confirmation...`);

  await algosdk.waitForConfirmation(algodClient, txId, 4);
  console.log(`[BLOCKCHAIN] Transaction ${txId} confirmed on TestNet!`);

  return {
    success: true,
    transactionId: txId,
    timestamp,
  };
}

module.exports = {
  recordVerificationOnChain,
};
