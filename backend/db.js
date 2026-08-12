const fs = require("fs");
const path = require("path");

const HISTORY_FILE = path.join(__dirname, "history.json");

/**
 * Database abstraction layer.
 * Standardized interface so history.json can easily be swapped with MongoDB / PostgreSQL.
 */
class HistoryDatabase {
  constructor() {
    this._ensureFileExists();
  }

  _ensureFileExists() {
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]), "utf8");
    }
  }

  _readAll() {
    try {
      const data = fs.readFileSync(HISTORY_FILE, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Failed to read history.json:", err);
      return [];
    }
  }

  _writeAll(records) {
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to write history.json:", err);
    }
  }

  /**
   * Save a verification record.
   * @param {Object} record
   */
  async saveVerificationRecord(record) {
    const records = this._readAll();
    const newRecord = {
      id: record.id || `ver_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      walletAddress: record.walletAddress,
      newsHash: record.newsHash,
      prediction: record.prediction,
      timestamp: record.timestamp || new Date().toISOString(),
      verificationTransactionId: record.verificationTransactionId || null,
      paymentTransactionId: record.paymentTransactionId || null,
      paymentStatus: record.paymentStatus || "paid",
      createdAt: new Date().toISOString(),
    };

    records.unshift(newRecord);
    this._writeAll(records);
    return newRecord;
  }

  /**
   * Get verification records by wallet address.
   * @param {string} walletAddress
   */
  async getByWallet(walletAddress) {
    const records = this._readAll();
    if (!walletAddress) return records;
    return records.filter(
      (r) => r.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
    );
  }

  /**
   * Get all verification records.
   */
  async getAll() {
    return this._readAll();
  }

  /**
   * Get verification record by SHA-256 hash.
   * @param {string} newsHash
   */
  async getByHash(newsHash) {
    const records = this._readAll();
    return records.find((r) => r.newsHash === newsHash) || null;
  }
}

module.exports = new HistoryDatabase();
