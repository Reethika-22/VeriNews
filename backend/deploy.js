require("dotenv").config();

const fs = require("fs");
const path = require("path");
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

async function deployContract() {
  console.log("==================================================");
  console.log(" VeriNews Smart Contract Deployment Script ");
  console.log("==================================================");

  let reporterAccount;

  if (process.env.REPORTER_MNEMONIC) {
    reporterAccount = algosdk.mnemonicToSecretKey(process.env.REPORTER_MNEMONIC);
    console.log("Using existing REPORTER_MNEMONIC from .env");
  } else {
    reporterAccount = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(reporterAccount.sk);
    const addrStr = getAddressString(reporterAccount.addr);
    console.log("\nGenerated new TestNet reporter account:");
    console.log("Address:", addrStr);
    console.log("Mnemonic:", mnemonic);
    console.log("\nPlease fund this address on TestNet via https://dispenser.testnet.aws.algorand.community/");
    console.log("And set REPORTER_MNEMONIC in your backend .env file.\n");
  }

  const reporterAddrStr = getAddressString(reporterAccount.addr);
  console.log("Service Account Address:", reporterAddrStr);

  // Check Account Balance
  try {
    const accountInfo = await algodClient.accountInformation(reporterAddrStr).do();
    const rawAmount = accountInfo.amount !== undefined ? accountInfo.amount : accountInfo["amount"];
    const balanceAlgo = Number(rawAmount) / 1e6;
    console.log(`Current Balance: ${balanceAlgo} ALGO`);

    if (balanceAlgo < 0.1) {
      console.error("\n[ERROR] Account balance is too low to deploy smart contract on TestNet.");
      console.error(`Please fund ${reporterAddrStr} using the Algorand TestNet Dispenser: https://dispenser.testnet.aws.algorand.community/\n`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Failed to fetch account info from Algod:", err.message);
    process.exit(1);
  }

  // Paths to compiled TEAL files
  const approvalPath = path.join(
    __dirname,
    "../blockchain/verinewscontract/projects/verinewscontract/smart_contracts/artifacts/veri_news/VeriNews.approval.teal"
  );
  const clearPath = path.join(
    __dirname,
    "../blockchain/verinewscontract/projects/verinewscontract/smart_contracts/artifacts/veri_news/VeriNews.clear.teal"
  );

  if (!fs.existsSync(approvalPath) || !fs.existsSync(clearPath)) {
    console.error("TEAL artifact files not found at expected paths.");
    process.exit(1);
  }

  console.log("Reading TEAL contracts...");
  const approvalSource = fs.readFileSync(approvalPath, "utf8");
  const clearSource = fs.readFileSync(clearPath, "utf8");

  // Compile TEAL
  console.log("Compiling approval and clear TEAL programs...");
  const approvalCompiled = await algodClient.compile(approvalSource).do();
  const clearCompiled = await algodClient.compile(clearSource).do();

  const approvalBytes = new Uint8Array(Buffer.from(approvalCompiled.result, "base64"));
  const clearBytes = new Uint8Array(Buffer.from(clearCompiled.result, "base64"));

  // Get suggested params
  const suggestedParams = await algodClient.getTransactionParams().do();

  // Create App Txn
  console.log("Building ApplicationCreate transaction...");
  const appCreateTxn = algosdk.makeApplicationCreateTxnFromObject({
    from: reporterAddrStr,
    suggestedParams,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approvalBytes,
    clearProgram: clearBytes,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 0,
    numGlobalByteSlices: 0,
  });

  // Sign transaction
  const signedTxn = appCreateTxn.signTxn(reporterAccount.sk);
  console.log("Submitting deployment transaction to Algorand TestNet...");

  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId = sendResult.txId || sendResult.txid || sendResult;
  console.log("Transaction ID:", txId);

  console.log("Waiting for confirmation...");
  const confirmation = await algosdk.waitForConfirmation(algodClient, txId, 4);
  const appId = Number(confirmation["application-index"]);

  console.log("==================================================");
  console.log(`SUCCESS! Smart Contract Deployed to Algorand TestNet.`);
  console.log(`APP_ID: ${appId}`);
  console.log(`Transaction ID: ${txId}`);
  console.log("==================================================");

  // Update .env file with APP_ID and REPORTER_MNEMONIC
  const envPath = path.join(__dirname, ".env");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  if (envContent.includes("APP_ID=")) {
    envContent = envContent.replace(/APP_ID=.*/g, `APP_ID=${appId}`);
  } else {
    envContent += `\nAPP_ID=${appId}`;
  }

  const mnemonicStr = algosdk.secretKeyToMnemonic(reporterAccount.sk);
  if (envContent.includes("REPORTER_MNEMONIC=")) {
    envContent = envContent.replace(/REPORTER_MNEMONIC=.*/g, `REPORTER_MNEMONIC="${mnemonicStr}"`);
  } else {
    envContent += `\nREPORTER_MNEMONIC="${mnemonicStr}"`;
  }

  fs.writeFileSync(envPath, envContent.trim() + "\n");
  console.log("Updated backend/.env with APP_ID and REPORTER_MNEMONIC.");
}

deployContract().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
