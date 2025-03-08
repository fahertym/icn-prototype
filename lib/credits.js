/**
 * ICN Credit System
 * Implements the cooperative economic model
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

class CreditSystem {
  constructor(nodeId, config, logger) {
    this.nodeId = nodeId;
    this.config = config;
    this.logger = logger;
    this.balances = new Map(); // NodeID -> balance
    this.transactions = [];
    this.activeTransactions = new Map(); // transactionId -> transaction
    
    // Ensure this node has a balance
    this.balances.set(nodeId, 1000);
    
    // Load existing credit data
    this._loadCreditData();
  }
  
  async _loadCreditData() {
    try {
      const creditsPath = path.join(process.cwd(), 'data', 'credits.json');
      
      if (fs.existsSync(creditsPath)) {
        const data = await promisify(fs.readFile)(creditsPath, 'utf8');
        const creditData = JSON.parse(data);
        
        // Load balances
        if (creditData.balances) {
          Object.entries(creditData.balances).forEach(([nodeId, balance]) => {
            this.balances.set(nodeId, balance);
          });
        }
        
        // Load transactions
        if (creditData.transactions) {
          this.transactions = creditData.transactions;
        }
        
        // Load active transactions
        if (creditData.activeTransactions) {
          Object.entries(creditData.activeTransactions).forEach(([txId, tx]) => {
            this.activeTransactions.set(txId, tx);
          });
        }
        
        this.logger.info(`Loaded credit data: ${this.transactions.length} transactions, ${this.balances.size} balances`);
      }
    } catch (err) {
      this.logger.error('Failed to load credit data:', err);
    }
  }
  
  async _saveCreditData() {
    try {
      const creditsPath = path.join(process.cwd(), 'data', 'credits.json');
      
      const creditData = {
        balances: Object.fromEntries(this.balances),
        transactions: this.transactions,
        activeTransactions: Object.fromEntries(this.activeTransactions)
      };
      
      await promisify(fs.writeFile)(
        creditsPath,
        JSON.stringify(creditData, null, 2),
        'utf8'
      );
    } catch (err) {
      this.logger.error('Failed to save credit data:', err);
    }
  }
  
  /**
   * Get balance for a node
   */
  async getBalance(nodeId) {
    return this.balances.get(nodeId) || 0;
  }
  
  /**
   * Start tracking resource usage for a workload
   */
  async startResourceTracking(workloadId, consumerId, providerId) {
    try {
      const transactionId = `${workloadId}-${Date.now()}`;
      
      // Initialize balances if needed
      if (!this.balances.has(consumerId)) {
        this.balances.set(consumerId, 1000);
      }
      if (!this.balances.has(providerId)) {
        this.balances.set(providerId, 1000);
      }
      
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
      
      await this._saveCreditData();
      
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
        throw new Error(`Transaction not found: ${transactionId}`);
      }
      
      const transaction = this.activeTransactions.get(transactionId);
      
      // Update resource usage
      transaction.resourceUsage.cpuSeconds += usage.cpuSeconds || 0;
      transaction.resourceUsage.memoryMbSeconds += usage.memoryMbSeconds || 0;
      transaction.resourceUsage.storageGbHours += usage.storageGbHours || 0;
      transaction.resourceUsage.bandwidthGb += usage.bandwidthGb || 0;
      
      // Calculate estimated credits
      transaction.estimatedCredits = this._calculateCredits(transaction.resourceUsage);
      
      // Update in memory and persist
      this.activeTransactions.set(transactionId, transaction);
      await this._saveCreditData();
      
      return transaction;
    } catch (err) {
      this.logger.error(`Failed to update resource usage for ${transactionId}:`, err);
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
   * Complete a transaction and settle credits
   */
  async completeTransaction(transactionId) {
    try {
      if (!this.activeTransactions.has(transactionId)) {
        throw new Error(`Transaction not found: ${transactionId}`);
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
      
      // Add to completed transactions
      this.transactions.push(transaction);
      
      // Remove from active transactions
      this.activeTransactions.delete(transactionId);
      
      // Save changes
      await this._saveCreditData();
      
      this.logger.info(`Transaction ${transactionId} completed, ${creditAmount} credits transferred`);
      return transaction;
    } catch (err) {
      this.logger.error(`Failed to complete transaction ${transactionId}:`, err);
      throw err;
    }
  }
  
  /**
   * Transfer credits between nodes
   */
  async _transferCredits(fromNodeId, toNodeId, amount, description) {
    try {
      // Get current balances
      const fromBalance = this.balances.get(fromNodeId) || 0;
      const toBalance = this.balances.get(toNodeId) || 0;
      
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
      this.balances.set(fromNodeId, fromBalance - amount);
      this.balances.set(toNodeId, toBalance + amount);
      
      // Store transfer record
      this.transactions.push(transfer);
      
      // Save changes
      await this._saveCreditData();
      
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
    try {
      // Filter transactions involving this node
      const nodeTransactions = this.transactions.filter(tx => 
        (tx.consumerId === nodeId || tx.providerId === nodeId) ||
        (tx.fromNodeId === nodeId || tx.toNodeId === nodeId)
      );
      
      // Sort by timestamp descending and limit
      return nodeTransactions
        .sort((a, b) => {
          const aTime = a.timestamp || a.startTime;
          const bTime = b.timestamp || b.startTime;
          return bTime - aTime;
        })
        .slice(0, limit);
    } catch (err) {
      this.logger.error('Error getting transaction history:', err);
      throw err;
    }
  }
  
  /**
   * Get all active transactions
   */
  async getActiveTransactions() {
    return Array.from(this.activeTransactions.values());
  }
  
  /**
   * Get all nodes with their balances
   */
  async getAllBalances() {
    return Object.fromEntries(this.balances);
  }
  
  /**
   * Add credits to a node (for system operations)
   */
  async addCredits(nodeId, amount, reason) {
    try {
      // Initialize balance if needed
      if (!this.balances.has(nodeId)) {
        this.balances.set(nodeId, 0);
      }
      
      const currentBalance = this.balances.get(nodeId);
      this.balances.set(nodeId, currentBalance + amount);
      
      // Record the credit addition as a transaction
      const creditAddition = {
        id: `credit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        toNodeId: nodeId,
        amount,
        description: reason || 'System credit addition',
        timestamp: Date.now(),
        type: 'credit_addition'
      };
      
      this.transactions.push(creditAddition);
      
      // Save changes
      await this._saveCreditData();
      
      this.logger.info(`Added ${amount} credits to ${nodeId}: ${reason}`);
      return creditAddition;
    } catch (err) {
      this.logger.error(`Failed to add credits to ${nodeId}:`, err);
      throw err;
    }
  }
}

module.exports = CreditSystem;
