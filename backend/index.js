require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { paymentMiddleware } = require("@x402/express");
const {
  x402ResourceServer,
  HTTPFacilitatorClient,
} = require("@x402/core/server");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

const RECEIVER = process.env.AVM_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL;

// ------------------------------------
// x402 Facilitator
// ------------------------------------

const facilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

const x402Server = new x402ResourceServer(facilitator);

x402Server.initialize();

// ------------------------------------
// x402 Payment Middleware
// ------------------------------------

app.use(
  paymentMiddleware(
    {
      "POST /verify": {
        accepts: {
          scheme: "exact",
          network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe",
          payTo: RECEIVER,
          price: "$0.01",
        },
        description: "VeriNews AI News Verification",
        mimeType: "application/json",
      },
    },
    x402Server
  )
);

// ------------------------------------
// Home
// ------------------------------------

app.get("/", (req, res) => {
  res.send("VeriNews Backend is Running");
});

// ------------------------------------
// Verify News
// ------------------------------------

app.post("/verify", async (req, res) => {
  try {
    const news = req.body.text;

    if (!news || !news.trim()) {
      return res.status(400).json({
        error: "News text is required",
      });
    }

    console.log("News received");

    // AI prediction
    const response = await axios.post(
      "http://127.0.0.1:5000/predict",
      {
        text: news,
      }
    );

    const prediction = response.data.prediction;

    // SHA-256 hash
    const hash = crypto
      .createHash("sha256")
      .update(news)
      .digest("hex");

    console.log("Prediction:", prediction);
    console.log("Hash:", hash);

    res.json({
      prediction,
      hash,
      message: "News verified successfully",
    });

  } catch (error) {
    console.error("Verification error:", error.message);

    res.status(500).json({
      error: "Failed to verify news",
    });
  }
});

// ------------------------------------
// Start Server
// ------------------------------------

async function startServer() {
  await x402Server.initialize();

  app.listen(PORT, () => {
    console.log(`VeriNews Backend running on http://localhost:${PORT}`);
  });
}

startServer();