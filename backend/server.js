require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { HTTPFacilitatorClient, x402ResourceServer } = require("@x402/core/server");
const { paymentMiddleware } = require("@x402/express");
const { ExactAvmScheme } = require("@x402/avm/exact/server");

const db = require("./db");
const { recordVerificationOnChain } = require("./blockchain");

const app = express();

// =====================================================
// CORS & EXPOSED HEADERS (Required for browser x402/fetch)
// =====================================================
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: [
      "PAYMENT-REQUIRED",
      "X-PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE",
      "payment-required",
      "x-payment-required",
      "payment-response",
      "x-payment-response",
    ],
  })
);

app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Expose-Headers",
    "PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, payment-required, x-payment-required, payment-response, x-payment-response"
  );
  next();
});

app.use(express.json());

const RECEIVER = process.env.AVM_ADDRESS || "OM5PDVGWI6QFCL3PPSMZ6MAG7QYKJIUN2L2VGKZXBVA3IC6LYLPZI2RUSM";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";
const NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:5000";

console.log("==================================================");
console.log(" VeriNews Backend Server Configuration");
console.log("==================================================");
console.log("Receiver Address:", RECEIVER);
console.log("Facilitator URL :", FACILITATOR_URL);
console.log("Algorand Network:", NETWORK);
console.log("Smart App ID    :", process.env.APP_ID || "769119533");
console.log("==================================================");

// =====================================================
// PUBLIC ENDPOINTS
// =====================================================

app.get("/", (req, res) => {
  res.send("VeriNews Backend API Running");
});

app.get("/health", async (req, res) => {
  let aiStatus = false;
  try {
    const aiRes = await axios.get(`${AI_SERVICE_URL}/health`, { timeout: 2000 });
    aiStatus = aiRes.data?.status === "ok";
  } catch (err) {
    aiStatus = false;
  }

  res.json({
    status: "ok",
    ai: aiStatus,
    blockchain: !!process.env.APP_ID,
    x402: true,
    appId: process.env.APP_ID || "769119533",
    receiver: RECEIVER,
  });
});

app.get("/history", async (req, res) => {
  try {
    const records = await db.getAll();
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch verification history" });
  }
});

app.get("/history/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const records = await db.getByWallet(walletAddress);
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history for wallet" });
  }
});

app.get("/verification/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    const record = await db.getByHash(hash);
    if (!record) {
      return res.status(404).json({ error: "Verification record not found" });
    }
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch record by hash" });
  }
});

// =====================================================
// x402 MIDDLEWARE & RESOURCE SERVER SETUP
// =====================================================

const facilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

const x402Server = new x402ResourceServer(facilitator);
x402Server.register(NETWORK, new ExactAvmScheme());

const routes = {
  "POST /verify": {
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        payTo: RECEIVER,
        price: "0.001", // $0.001 TestNet USDC (Asset ID 10458941 -> 1000 base units)
        maxTimeoutSeconds: 120,
      },
    ],
    description: "VeriNews AI News Verification",
    mimeType: "application/json",
  },
};

// Mount x402 middleware
app.use(paymentMiddleware(routes, x402Server, null, null, false));

/**
 * Helper to extract authenticated payer address from x402 header
 */
function getAuthenticatedPayerAddress(req) {
  const header = req.headers["payment-signature"] || req.headers["x-payment"];
  if (header) {
    try {
      const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      if (decoded?.payload?.authorization?.from) {
        return decoded.payload.authorization.from;
      }
      if (decoded?.payload?.authorization?.sender) {
        return decoded.payload.authorization.sender;
      }
    } catch (e) {
      console.warn("Could not parse payment signature header for wallet address:", e.message);
    }
  }

  return req.body?.walletAddress || "UNKNOWN_PAYER";
}

// =====================================================
// PROTECTED X402 VERIFY ENDPOINT
// =====================================================

app.post("/verify", async (req, res) => {
  try {
    const news = req.body.text;

    if (!news || !news.trim()) {
      return res.status(400).json({
        error: "News text is required for verification.",
      });
    }

    const payerWalletAddress = getAuthenticatedPayerAddress(req);
    console.log(`[VERIFY] Paid request received from wallet: ${payerWalletAddress}`);

    // Step 1: Call Python AI service for prediction
    console.log("[VERIFY] Sending news article to AI prediction service...");
    let prediction = "UNKNOWN";
    try {
      const aiResponse = await axios.post(
        `${AI_SERVICE_URL}/predict`,
        { text: news },
        { timeout: 10000 }
      );
      prediction = aiResponse.data.prediction;
      console.log(`[VERIFY] AI Prediction: ${prediction}`);
    } catch (aiErr) {
      console.error("[VERIFY ERROR] AI Service failed:", aiErr.message);
      return res.status(502).json({
        error: "AI News Verification service is currently unavailable.",
      });
    }

    // Step 2: Generate SHA-256 Hash of exact news content
    const newsHash = crypto.createHash("sha256").update(news).digest("hex");
    console.log(`[VERIFY] SHA-256 Hash: ${newsHash}`);

    const timestamp = new Date().toISOString();

    // Step 3: Record Verification on Algorand Smart Contract
    let transactionId = null;
    let blockchainStatus = "FAILED";

    if (process.env.APP_ID && process.env.REPORTER_MNEMONIC) {
      try {
        console.log(`[VERIFY] Recording verification on Algorand App ID ${process.env.APP_ID}...`);
        const onChainResult = await recordVerificationOnChain(newsHash, prediction, timestamp);
        transactionId = onChainResult.transactionId;
        blockchainStatus = "CONFIRMED";
        console.log(`[VERIFY] Smart contract call succeeded. TxId: ${transactionId}`);
      } catch (bcErr) {
        console.error("[VERIFY ERROR] Blockchain transaction failed:", bcErr.message);
        blockchainStatus = "PENDING: " + bcErr.message;
      }
    } else {
      console.warn("[VERIFY WARN] APP_ID or REPORTER_MNEMONIC not configured in backend/.env.");
    }

    // Step 4: Persist in Database (history.json DAO)
    const record = await db.saveVerificationRecord({
      walletAddress: payerWalletAddress,
      newsHash,
      prediction,
      timestamp,
      verificationTransactionId: transactionId,
      paymentStatus: "paid",
    });

    // Step 5: Return complete verification response
    return res.json({
      success: true,
      prediction,
      hash: newsHash,
      walletAddress: payerWalletAddress,
      transactionId,
      timestamp,
      paymentStatus: "paid",
      blockchainStatus,
      recordId: record.id,
    });

  } catch (error) {
    console.error("[VERIFY ERROR] Server processing failed:", error.message);
    return res.status(500).json({
      error: "An internal server error occurred while verifying the news.",
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log("[x402] Initializing x402 Resource Server with facilitator...");
    await x402Server.initialize();
    console.log("[x402] Resource Server initialized successfully.");

    app.listen(PORT, () => {
      console.log(`VeriNews Backend server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[x402 INIT ERROR] Failed to initialize x402 server:", err.message);
    app.listen(PORT, () => {
      console.log(`VeriNews Backend server listening on http://localhost:${PORT} (fallback mode)`);
    });
  }
}

startServer();