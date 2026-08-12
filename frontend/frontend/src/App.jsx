import { useEffect, useState } from "react";
import { peraWallet } from "./peraWallet";
import algosdk from "algosdk";

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm";

import "./App.css";

const TESTNET_NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
const BACKEND_URL = "http://localhost:3000";

// ======================================================
// Pera Wallet -> x402 AVM Signer
// ======================================================

function createPeraSigner(accountAddress, onSigningStarted) {
  return {
    address: accountAddress,

    signTransactions: async (txns, indexesToSign) => {
      if (onSigningStarted) onSigningStarted();

      console.log("[PERA] Preparing atomic transaction group for Pera Wallet:", {
        totalTxns: txns.length,
        indexesToSign,
      });

      // Construct SignerTransaction objects for complete group
      const signerTransactions = txns.map((txnBytes, index) => {
        const txn = algosdk.decodeUnsignedTransaction(txnBytes);
        const shouldSign = !indexesToSign || indexesToSign.includes(index);

        return {
          txn,
          signers: shouldSign ? [accountAddress] : [],
        };
      });

      console.log("[PERA] Opening Pera Wallet modal for group signing...");

      // Pera Wallet returns Uint8Array[] corresponding to signed items in indexesToSign
      const signedTxns = await peraWallet.signTransaction([signerTransactions]);

      console.log("[PERA] Signed transactions returned by Pera Wallet:", signedTxns);

      return txns.map((_, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) {
          return null;
        }

        const relativeIndex = indexesToSign ? indexesToSign.indexOf(i) : i;
        const item = signedTxns[relativeIndex] || signedTxns[i];
        if (!item) return null;

        if (item instanceof Uint8Array) {
          return item;
        }
        if (Array.isArray(item) || (item && item.buffer)) {
          return new Uint8Array(item);
        }

        return item;
      });
    },
  };
}

function App() {
  const [activeTab, setActiveTab] = useState("about"); // about | verify | dashboard | history | settings
  const [theme, setTheme] = useState(() => localStorage.getItem("verinews_theme") || "dark");
  const [news, setNews] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0); // 1..7
  const [stepMessage, setStepMessage] = useState("");
  const [error, setError] = useState("");
  const [accountAddress, setAccountAddress] = useState(null);
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMyWallet, setFilterMyWallet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Apply Theme to document root & persist to localStorage
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("verinews_theme", theme);
  }, [theme]);

  // Reconnect Wallet Session on Refresh
  useEffect(() => {
    const reconnectWallet = async () => {
      try {
        const accounts = await peraWallet.reconnectSession();
        if (accounts && accounts.length > 0) {
          setAccountAddress(accounts[0]);
        }
      } catch (err) {
        console.log("No existing Pera Wallet session.");
      }
    };
    reconnectWallet();
  }, []);

  // Fetch History whenever tab changes or after verification
  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/history`);
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setHistory(data.records);
      }
    } catch (e) {
      console.warn("Could not load history from backend:", e.message);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [activeTab]);

  // Connect Wallet
  const connectWallet = async () => {
    try {
      setError("");
      const accounts = await peraWallet.connect();
      if (accounts && accounts.length > 0) {
        setAccountAddress(accounts[0]);
      }
    } catch (err) {
      console.error("Wallet connection failed:", err);
      if (err?.data?.type !== "CONNECT_MODAL_CLOSED") {
        setError("Unable to connect Pera Wallet.");
      }
    }
  };

  // Disconnect Wallet
  const disconnectWallet = async () => {
    try {
      await peraWallet.disconnect();
      setAccountAddress(null);
      setResult(null);
      setError("");
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  };

  // Copy Wallet Address Helper
  const copyWalletAddress = () => {
    if (!accountAddress) return;
    navigator.clipboard.writeText(accountAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Step indicator helper
  const updateProgress = (stepNum, message) => {
    setCurrentStep(stepNum);
    setStepMessage(message);
  };

  // ====================================================
  // Verify News Flow (x402 + Pera + AI + Smart Contract)
  // ====================================================
  const verifyNews = async () => {
    if (loading) return;

    if (!news.trim()) {
      setError("Please paste a news article to verify.");
      return;
    }

    if (!accountAddress) {
      setError("Please connect your Pera Wallet first to sign the x402 verification payment.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      updateProgress(1, "Step 1: Preparing news verification request...");

      const peraSigner = createPeraSigner(accountAddress, () => {
        updateProgress(3, "Step 3: Open Pera Wallet on your device and approve the $0.001 payment transaction.");
      });

      const client = new x402Client();
      client.register(TESTNET_NETWORK, new ExactAvmScheme(peraSigner));

      const fetchWithPayment = wrapFetchWithPayment(fetch, client);

      updateProgress(2, "Step 2: x402 payment required ($0.001 TestNet). Initiating signing...");

      console.log("[VERIFY] Sending POST request to backend via x402 fetchWithPayment...");

      const response = await fetchWithPayment(`${BACKEND_URL}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: news,
          walletAddress: accountAddress,
        }),
      });

      updateProgress(4, "Step 4: Payment verified by facilitator! AI service analyzing news...");

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || `Verification failed with status ${response.status}`);
      }

      updateProgress(5, `Step 5: AI Prediction complete: ${data.prediction}. Generating SHA-256 proof...`);
      updateProgress(6, "Step 6: Recording verification proof on Algorand Smart Contract...");

      // Final success
      updateProgress(7, "Step 7: Verification complete!");
      setResult(data);
      fetchHistory();

    } catch (err) {
      console.error("[VERIFY ERROR]:", err);
      const errorMessage = err?.message || "";

      if (
        errorMessage.includes("Transaction request pending") ||
        errorMessage.includes("transaction request in progress")
      ) {
        setError(
          "Pera Wallet has a pending transaction request in progress. Please approve or reject the request in your Pera Wallet app, then try again."
        );
      } else if (
        errorMessage.toLowerCase().includes("reject") ||
        errorMessage.toLowerCase().includes("cancel") ||
        errorMessage.toLowerCase().includes("decline")
      ) {
        setError("Payment signing was cancelled in Pera Wallet.");
      } else {
        setError(errorMessage || "Unable to complete verification. Please check backend status.");
      }
    } finally {
      setTimeout(() => {
        setLoading(false);
        setCurrentStep(0);
      }, 1200);
    }
  };

  // Format Explorer URL
  const getExplorerUrl = (txId) => {
    if (!txId) return "#";
    return `https://testnet.explorer.perawallet.app/tx/${txId}`;
  };

  // Dashboard Stats
  const totalVerifications = history.length;
  const realCount = history.filter((r) => r.prediction?.toUpperCase() === "REAL").length;
  const fakeCount = history.filter((r) => r.prediction?.toUpperCase() === "FAKE").length;
  const totalPaymentsUsd = (totalVerifications * 0.001).toFixed(3);

  // Filtered History
  const filteredHistory = history.filter((r) => {
    if (filterMyWallet && accountAddress && r.walletAddress?.toLowerCase() !== accountAddress.toLowerCase()) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hashMatch = r.newsHash?.toLowerCase().includes(q);
      const predMatch = r.prediction?.toLowerCase().includes(q);
      const walletMatch = r.walletAddress?.toLowerCase().includes(q);
      const txMatch = r.verificationTransactionId?.toLowerCase().includes(q);
      return hashMatch || predMatch || walletMatch || txMatch;
    }
    return true;
  });

  return (
    <div className="app">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="logo-section" onClick={() => setActiveTab("about")}>
          <div className="logo-emblem">
            <svg viewBox="0 0 24 24" className="logo-svg">
              <path
                d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 12l2 2 4-4"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="logo">
            Veri<span>News</span>
          </div>
          <span className="tech-badge">AI × BLOCKCHAIN × x402</span>
        </div>

        {/* 1st TAB IS ABOUT */}
        <div className="nav-links">
          <button
            className={`nav-link ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
          <button
            className={`nav-link ${activeTab === "verify" ? "active" : ""}`}
            onClick={() => setActiveTab("verify")}
          >
            Verify News
          </button>
          <button
            className={`nav-link ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`nav-link ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
          <button
            className={`nav-link ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </div>

        <div className="nav-right-actions">
          {/* Connect / Disconnect Wallet Button */}
          <button
            className={`wallet-btn ${accountAddress ? "connected" : ""}`}
            onClick={accountAddress ? () => setActiveTab("settings") : connectWallet}
            title={accountAddress ? "View Wallet Details in Settings" : "Connect Pera Wallet"}
          >
            {accountAddress ? (
              <>
                <span className="status-dot"></span>
                {accountAddress.slice(0, 6)}...{accountAddress.slice(-4)}
              </>
            ) : (
              "Connect Pera Wallet"
            )}
          </button>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="container">
        {/* TAB 1: ABOUT VERINEWS (FIRST TAB) */}
        {activeTab === "about" && (
          <div className="tab-content">
            <div className="about-hero-card">
              <div className="about-logo-wrapper">
                <svg viewBox="0 0 24 24" className="logo-svg" style={{ width: "48px", height: "48px" }}>
                  <path
                    d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 12l2 2 4-4"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2>VeriNews Protocol</h2>
              <p>
                Decentralized AI-powered news verification system leveraging Machine Learning, SHA-256 cryptographic proofs, Algorand TestNet Smart Contracts, and x402 micro-payments.
              </p>
            </div>

            <div className="about-grid">
              <div className="about-card">
                <span className="about-icon">🧠</span>
                <h3>AI / Machine Learning</h3>
                <p>
                  Articles are evaluated using a trained Natural Language Processing model utilizing TF-IDF vectorization and Logistic Regression trained on fake news datasets to identify deceptive linguistic patterns.
                </p>
              </div>

              <div className="about-card">
                <span className="about-icon">🔒</span>
                <h3>SHA-256 Integrity</h3>
                <p>
                  The exact news content generates a unique 256-bit cryptographic hash digest. This ensures off-chain text privacy while maintaining tamper-evident integrity proof.
                </p>
              </div>

              <div className="about-card">
                <span className="about-icon">⛓️</span>
                <h3>Algorand Smart Contract</h3>
                <p>
                  Verification proofs (Hash + Prediction + Timestamp) are committed directly to the Algorand TestNet blockchain via ARC-56 ABI smart contract calls (App ID: 769119533), providing permanent public auditability.
                </p>
              </div>

              <div className="about-card">
                <span className="about-icon">⚡</span>
                <h3>x402 Micro-Payments</h3>
                <p>
                  x402 is an open HTTP 402 payment standard enabling automatic web3 micro-payments. Each news verification requires a $0.001 payment authorization handled seamlessly in-browser.
                </p>
              </div>
            </div>

            <div className="about-cta-banner">
              <h3>Ready to Verify an Article?</h3>
              <p>Experience instant decentralized news verification on Algorand TestNet.</p>
              <button className="about-cta-btn" onClick={() => setActiveTab("verify")}>
                Start News Verification →
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: VERIFY NEWS */}
        {activeTab === "verify" && (
          <div className="tab-content">
            <section className="hero">
              <p className="badge">ALGORAND TESTNET • X402 PAYMENT PROTOCOL</p>
              <h1>
                Verify News.
                <br />
                <span>Trust the Truth.</span>
              </h1>
              <p className="subtitle">
                Analyze articles using Machine Learning and record a tamper-resistant verification proof on the Algorand blockchain via x402 micro-payments.
              </p>
            </section>

            <section className="verify-card">
              <div className="card-header">
                <h2>Verify a News Article</h2>
                <p>Paste the article headline or body content below to inspect authenticity.</p>
              </div>

              <textarea
                value={news}
                onChange={(e) => setNews(e.target.value)}
                placeholder="Paste news article content here..."
                disabled={loading}
              />

              <div className="action-row">
                <div className="payment-details">
                  <span className="price-tag">$0.001</span>
                  <span className="payment-info">Verification Fee • x402 • Algorand TestNet</span>
                </div>

                <button
                  className="verify-btn"
                  onClick={verifyNews}
                  disabled={loading}
                >
                  {loading ? "Processing Verification..." : "Verify News"}
                </button>
              </div>
            </section>

            {/* PROGRESS STEP MODAL */}
            {loading && (
              <div className="progress-modal">
                <div className="progress-card">
                  <div className="spinner"></div>
                  <h3>Verification in Progress</h3>
                  <p className="step-desc">{stepMessage}</p>
                  <div className="step-bar">
                    <div
                      className="step-fill"
                      style={{ width: `${(currentStep / 7) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

            {/* ERROR DISPLAY */}
            {error && <div className="error-card">⚠️ {error}</div>}

            {/* RESULT CARD */}
            {result && (
              <section className="result-card">
                <div className="result-header">
                  <div>
                    <h2>VERIFICATION RESULT</h2>
                    <p className="timestamp-text">Verified on {new Date(result.timestamp).toLocaleString()}</p>
                  </div>

                  <span className={`result-badge ${result.prediction?.toLowerCase()}`}>
                    {result.prediction === "REAL" ? "✓ REAL NEWS" : "⚠️ FAKE NEWS"}
                  </span>
                </div>

                <div className="result-grid">
                  <div className="result-item">
                    <label>AI Prediction</label>
                    <strong className={result.prediction?.toLowerCase()}>
                      {result.prediction}
                    </strong>
                  </div>

                  <div className="result-item">
                    <label>SHA-256 News Content Hash</label>
                    <code>{result.hash}</code>
                  </div>

                  <div className="result-item">
                    <label>Authenticated Payer Wallet</label>
                    <code>{result.walletAddress}</code>
                  </div>

                  <div className="result-item">
                    <label>x402 Micro-Payment</label>
                    <span className="payment-status-badge">PAID — $0.001</span>
                  </div>

                  <div className="result-item">
                    <label>Algorand Smart Contract</label>
                    <span className="blockchain-status-badge">CONFIRMED ON TESTNET</span>
                  </div>

                  {result.transactionId && (
                    <div className="result-item full-width">
                      <label>Algorand Transaction ID</label>
                      <code>{result.transactionId}</code>
                    </div>
                  )}
                </div>

                {result.transactionId && (
                  <div className="explorer-action">
                    <a
                      href={getExplorerUrl(result.transactionId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="explorer-btn"
                    >
                      View on Algorand Explorer ↗
                    </a>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* TAB 3: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="tab-content">
            <div className="page-header">
              <h1>Platform Dashboard</h1>
              <p>Real-time analytics and news verification telemetry on Algorand TestNet.</p>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon">📊</span>
                <div className="stat-info">
                  <h3>Total Verifications</h3>
                  <div className="stat-value">{totalVerifications}</div>
                </div>
              </div>

              <div className="stat-card real-border">
                <span className="stat-icon">✅</span>
                <div className="stat-info">
                  <h3>Real News</h3>
                  <div className="stat-value real-color">{realCount}</div>
                </div>
              </div>

              <div className="stat-card fake-border">
                <span className="stat-icon">🚨</span>
                <div className="stat-info">
                  <h3>Fake News</h3>
                  <div className="stat-value fake-color">{fakeCount}</div>
                </div>
              </div>

              <div className="stat-card">
                <span className="stat-icon">⚡</span>
                <div className="stat-info">
                  <h3>Total x402 Payments</h3>
                  <div className="stat-value">${totalPaymentsUsd}</div>
                </div>
              </div>
            </div>

            {accountAddress && (
              <div className="wallet-card">
                <div className="wallet-card-header">
                  <h3>Connected Wallet Overview</h3>
                  <span className="network-pill">Algorand TestNet</span>
                </div>
                <div className="wallet-card-body">
                  <div>
                    <label>Address</label>
                    <code>{accountAddress}</code>
                  </div>
                  <div>
                    <label>User Verification Count</label>
                    <strong>
                      {history.filter((r) => r.walletAddress?.toLowerCase() === accountAddress.toLowerCase()).length} records
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <section className="history-section">
              <div className="section-header">
                <h2>Recent Verifications</h2>
              </div>

              {history.length === 0 ? (
                <div className="empty-state">No verification records found yet.</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Prediction</th>
                        <th>SHA-256 Hash</th>
                        <th>Payer Wallet</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.slice(0, 5).map((rec) => (
                        <tr key={rec.id}>
                          <td>{new Date(rec.timestamp).toLocaleDateString()}</td>
                          <td>
                            <span className={`mini-badge ${rec.prediction?.toLowerCase()}`}>
                              {rec.prediction}
                            </span>
                          </td>
                          <td>
                            <code title={rec.newsHash}>
                              {rec.newsHash?.slice(0, 12)}...
                            </code>
                          </td>
                          <td>
                            <code>
                              {rec.walletAddress
                                ? `${rec.walletAddress.slice(0, 6)}...${rec.walletAddress.slice(-4)}`
                                : "N/A"}
                            </code>
                          </td>
                          <td>
                            <span className="paid-tag">$0.001 Paid</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: VERIFICATION HISTORY */}
        {activeTab === "history" && (
          <div className="tab-content">
            <div className="page-header">
              <h1>Verification History</h1>
              <p>Explore complete immutable verification records saved on Algorand.</p>
            </div>

            <div className="filter-bar">
              <input
                type="text"
                placeholder="Search by Hash, Prediction, or Wallet Address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />

              {accountAddress && (
                <button
                  className={`filter-toggle ${filterMyWallet ? "active" : ""}`}
                  onClick={() => setFilterMyWallet(!filterMyWallet)}
                >
                  {filterMyWallet ? "Showing My Records Only" : "Show My Records Only"}
                </button>
              )}
            </div>

            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Prediction</th>
                    <th>SHA-256 Hash</th>
                    <th>Wallet Address</th>
                    <th>Payment</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="empty-cell">
                        No records match the current filter query.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((rec) => (
                      <tr key={rec.id}>
                        <td>{new Date(rec.timestamp).toLocaleString()}</td>
                        <td>
                          <span className={`mini-badge ${rec.prediction?.toLowerCase()}`}>
                            {rec.prediction}
                          </span>
                        </td>
                        <td>
                          <code>{rec.newsHash?.slice(0, 16)}...</code>
                        </td>
                        <td>
                          <code>
                            {rec.walletAddress
                              ? `${rec.walletAddress.slice(0, 6)}...${rec.walletAddress.slice(-4)}`
                              : "N/A"}
                          </code>
                        </td>
                        <td>
                          <span className="paid-tag">$0.001 Paid</span>
                        </td>
                        <td>
                          {rec.verificationTransactionId ? (
                            <a
                              href={getExplorerUrl(rec.verificationTransactionId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link-btn"
                            >
                              View on Explorer ↗
                            </a>
                          ) : (
                            <span className="muted">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS NAVIGATION */}
        {activeTab === "settings" && (
          <div className="tab-content">
            <div className="page-header">
              <h1>dApp Settings</h1>
              <p>Customize your theme preferences, Pera Wallet connection, and platform telemetry.</p>
            </div>

            <div className="settings-section-grid">
              {/* CARD 1: THEME SELECTION (DARK MODE / LIGHT MODE) */}
              <div className="settings-card">
                <div className="settings-card-header">
                  
                  <h3>Theme Preferences</h3>
                </div>
                <p className="settings-card-desc">
                  Choose between Dark Mode and Light Mode for the VeriNews interface.
                </p>

                <div className="theme-options-row">
                  <div
                    className={`theme-card-option ${theme === "dark" ? "active" : ""}`}
                    onClick={() => setTheme("dark")}
                  >
                    <div className="theme-svg-icon">
                      <svg viewBox="0 0 24 24">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    </div>
                    <div className="theme-name">Dark Mode</div>
                    <div className="theme-status">{theme === "dark" ? "Active" : "Select"}</div>
                  </div>

                  <div
                    className={`theme-card-option ${theme === "light" ? "active" : ""}`}
                    onClick={() => setTheme("light")}
                  >
                    <div className="theme-svg-icon">
                      <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                    </div>
                    <div className="theme-name">Light Mode</div>
                    <div className="theme-status">{theme === "light" ? "Active" : "Select"}</div>
                  </div>
                </div>
              </div>

              {/* CARD 2: PERA WALLET CONNECT / DISCONNECT MANAGEMENT */}
              <div className="settings-card">
                <div className="settings-card-header">
                 
                  <h3>Pera Wallet Management</h3>
                </div>
                <p className="settings-card-desc">
                  Manage your active Web3 wallet connection for signing x402 payment requests.
                </p>

                <div className="wallet-settings-status">
                  <div className="status-indicator-row">
                    <span className="status-label">Connection Status</span>
                    <span className={`status-badge ${accountAddress ? "connected" : "disconnected"}`}>
                      {accountAddress ? "✓ CONNECTED" : "DISCONNECTED"}
                    </span>
                  </div>

                  {accountAddress ? (
                    <div className="wallet-address-box">
                      <code>{accountAddress}</code>
                      <button className="copy-btn" onClick={copyWalletAddress}>
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <div className="wallet-address-box">
                      <code>No wallet connected</code>
                    </div>
                  )}

                  <button
                    className={`settings-wallet-btn ${accountAddress ? "disconnect-action" : "connect-action"}`}
                    onClick={accountAddress ? disconnectWallet : connectWallet}
                  >
                    {accountAddress ? "Disconnect Pera Wallet" : "Connect Pera Wallet"}
                  </button>
                </div>
              </div>

              {/* CARD 3: PLATFORM & X402 CONFIGURATION */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-icon">⚡</span>
                  <h3>Platform Configuration</h3>
                </div>
                <p className="settings-card-desc">
                  VeriNews decentralized protocol details and smart contract references.
                </p>

                <div className="settings-list">
                  <div className="settings-item">
                    <label>Network</label>
                    <span>Algorand TestNet</span>
                  </div>

                  <div className="settings-item">
                    <label>Payment Protocol</label>
                    <span>x402 (Exact AVM Scheme)</span>
                  </div>

                  <div className="settings-item">
                    <label>Verification Price</label>
                    <span>$0.001 USDC / ALGO</span>
                  </div>

                  <div className="settings-item">
                    <label>Smart App ID</label>
                    <span>769119533</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer>
        <p>VeriNews • Built with AI, Algorand TestNet, x402 & Pera Wallet</p>
      </footer>
    </div>
  );
}

export default App;