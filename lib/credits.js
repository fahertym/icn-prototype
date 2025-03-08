/**
 * ICN Credit System
 * Implements the cooperative economic model
 */
const level = require('level');
const path = require('path');

class CreditSystem {
  constructor(nodeId, config, logger) {
    this.nodeId = nodeId;
    this.config = config;
    this.logger = logger;
    this.creditsDb = null;
    this.activeTransactions = new Map();
    
    // Initialize database
    this._initDatabase();
  }
  
  async _initDatabase() {
    try {
      const dbPath = path.join(process.cwd(), 'data', 'credits');
      this.creditsDb = level(dbPath);
      
      // Ensure our node has a balance
      try {
        await this.getBalance(this.nodeId);
      } catch (error) {
        // Initialize with zero balance if not exists
        await this.creditsDb.put(`balance:${this.nodeId}`, '0');
      }
      
      this.logger.info('Credit system initialized');
    } catch (err) {
      this.logger.error('Failed to initialize credit system database:', err);
      throw err;
    }
  }
  
  /**
   * Get balance for a node
   */
  async getBalance(nodeId) {
    try {
      const balance = await this.creditsDb.get(`balance:${nodeId}`);
      return parseFloat(balance);
    } catch (err) {
      if (err.type === 'NotFoundError') {
        // Initialize new node with zero balance
        await this.creditsDb.put(`balance:${nodeId}`, '0');
        return 0;
      }
      throw err;
    }
  }
  
  /**
   * Start tracking resource usage for a workload
   */
  async startResourceTracking(workloadId, consumerId, providerId) {
    try {
      const transactionId = `${workloadId}-${Date.now()}`;
      
      // Record transaction start
      const transaction = {
        id: transactionId,
        workloadId,
        consumerId,
        providerId,
        startTime: Date.now(),
        status: 'active',
        resourceUsage: {
          cpuSeconds: 0,
          memoryMbSeconds: 0,
          storageGbHours: 0,
          bandwidthGb: 0
        },
        estimatedCredits: 0
      };
      
      // Store in memory for active tracking
      this.activeTransactions.set(transactionId, transaction);
      
      // Store in database
      await this.creditsDb.put(`transaction:${transactionId}`, JSON.stringify(transaction));
      
      return transactionId;
    } catch (err) {
      this.logger.error('Failed to start resource tracking:', err);
      throw err;
    }
  }
  
  /**
   * Update resource usage for a transaction
   */
  async updateResourceUsage(transactionId, usage) {
    try {
      if (!this.activeTransactions.has(transactionId)) {
        const txJson = await this.creditsDb.get(`transaction:${transactionId}`);
        this.activeTransactions.set(transactionId, JSON.parse(txJson));
      }
      
      const transaction = this.activeTransactions.get(transactionId);
      
      // Update resource usage
      Object.assign(transaction.resourceUsage, usage);
      
      // Calculate estimated credits
      transaction.estimatedCredits = this._calculateCredits(transaction.resourceUsage);
      
      // Update in memory and database
      this.activeTransactions.set(transactionId, transaction);
      await this.creditsDb.put(`transaction:${transactionId}`, JSON.stringify(transaction));
      
      return transaction;
    } catch (err) {
      this.logger.error(`Failed to update resource usage for ${transactionId}:`, err);
      throw err;
    }
  }
  
  /**
   * Complete a transaction and settle credits
   */
  async completeTransaction(transactionId) {
    try {
      if (!this.activeTransactions.has(transactionId)) {
        const txJson = await this.creditsDb.get(`transaction:${transactionId}`);
        this.activeTransactions.set(transactionId, JSON.parse(txJson));
      }
      
      const transaction = this.activeTransactions.get(transactionId);
      
      // Mark as completed
      transaction.status = 'completed';
      transaction.endTime = Date.now();
      
      // Calculate final credits
      const creditAmount = this._calculateCredits(transaction.resourceUsage);
      transaction.finalCredits = creditAmount;
      
      // Transfer credits from consumer to provider
      await this._transferCredits(
        transaction.consumerId, 
        transaction.providerId, 
        creditAmount,
        `Payment for workload ${transaction.workloadId}`
      );
      
      // Update transaction record
      await this.creditsDb.put(`transaction:${transactionId}`, JSON.stringify(transaction));
      
      // Remove from active transactions
      this.activeTransactions.delete(transactionId);
      
      this.logger.info(`Transaction ${transactionId} completed, ${creditAmount} credits transferred`);
      return transaction;
    } catch (err) {
      this.logger.error(`Failed to complete transaction ${transactionId}:`, err);
      throw err;
    }
  }
  
  /**
   * Calculate credits based on resource usage
   */
  _calculateCredits(usage) {
    // Simple credit calculation formula
    // In a real implementation, this would be more sophisticated
    const cpuCredits = usage.cpuSeconds * 0.01;
    const memoryCredits = usage.memoryMbSeconds * 0.001;
    const storageCredits = usage.storageGbHours * 0.05;
    const bandwidthCredits = usage.bandwidthGb * 0.1;
    
    return cpuCredits + memoryCredits + storageCredits + bandwidthCredits;
  }
  
  /**
   * Transfer credits between nodes
   */
  async _transferCredits(fromNodeId, toNodeId, amount, description) {
    // Start batch operation for atomicity
    const batch = this.creditsDb.batch();
    
    try {
      // Get current balances
      const fromBalance = await this.getBalance(fromNodeId);
      const toBalance = await this.getBalance(toNodeId);
      
      // Ensure sufficient balance
      if (fromBalance < amount) {
        throw new Error(`Insufficient credits: ${fromNodeId} has ${fromBalance}, needs ${amount}`);
      }
      
      // Create transfer record
      const transferId = `transfer-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const transfer = {
        id: transferId,
        fromNodeId,
        toNodeId,
        amount,
        description,
        timestamp: Date.now()
      };
      
      // Update balances
      batch.put(`balance:${fromNodeId}`, (fromBalance - amount).toString());
      batch.put(`balance:${toNodeId}`, (toBalance + amount).toString());
      
      // Store transfer record
      batch.put(`transfer:${transferId}`, JSON.stringify(transfer));
      
      // Commit changes
      await batch.write();
      
      this.logger.info(`Transferred ${amount} credits from ${fromNodeId} to ${toNodeId}`);
      return transfer;
    } catch (err) {
      this.logger.error('Failed to transfer credits:', err);
      throw err;
    }
  }
  
  /**
   * Get transaction history for a node
   */
  async getTransactionHistory(nodeId, limit = 20) {
    const transactions = [];
    
    return new Promise((resolve, reject) => {
      this.creditsDb.createReadStream({
        gte: 'transaction:',
        lte: 'transaction:\uffff'
      })
      .on('data', (data) => {
        const transaction = JSON.parse(data.value);
        if (transaction.consumerId === nodeId || transaction.providerId === nodeId) {
          transactions.push(transaction);
        }
      })
      .on('error', (err) => {
        this.logger.error('Error getting transaction history:', err);
        reject(err);
      })
      .on('end', () => {
        // Sort by timestamp descending and limit
        const sorted = transactions.sort((a, b) => b.startTime - a.startTime).slice(0, limit);
        resolve(sorted);
      });
    });
  }
}

module.exports = CreditSystem;
