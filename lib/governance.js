/**
 * ICN Governance Module
 * Implements democratic decision-making processes
 */
const level = require('level');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class GovernanceSystem {
  constructor(nodeId, config, logger) {
    this.nodeId = nodeId;
    this.config = config;
    this.logger = logger;
    this.governanceDb = null;
    this.activeProposals = new Map();
    
    // Initialize database
    this._initDatabase();
  }
  
  async _initDatabase() {
    try {
      const dbPath = path.join(process.cwd(), 'data', 'governance');
      this.governanceDb = level(dbPath);
      this.logger.info('Governance system initialized');
      
      // Load active proposals
      await this._loadActiveProposals();
    } catch (err) {
      this.logger.error('Failed to initialize governance database:', err);
      throw err;
    }
  }
  
  async _loadActiveProposals() {
    return new Promise((resolve, reject) => {
      this.governanceDb.createReadStream({
        gte: 'proposal:',
        lte: 'proposal:\uffff'
      })
      .on('data', (data) => {
        const proposal = JSON.parse(data.value);
        if (proposal.status === 'active') {
          this.activeProposals.set(proposal.id, proposal);
        }
      })
      .on('error', (err) => {
        this.logger.error('Error loading active proposals:', err);
        reject(err);
      })
      .on('end', () => {
        this.logger.info(`Loaded ${this.activeProposals.size} active proposals`);
        resolve();
      });
    });
  }
  
  /**
   * Create a new proposal
   */
  async createProposal(title, description, type, options, authorId, votingPeriod) {
    try {
      const proposalId = `proposal-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      const proposal = {
        id: proposalId,
        title,
        description,
        type, // 'simple', 'parameter', 'protocol', etc.
        options, // Array of options to vote on
        authorId,
        createdAt: Date.now(),
        status: 'active',
        votingPeriod: votingPeriod || 7 * 24 * 60 * 60 * 1000, // Default 7 days
        endsAt: Date.now() + (votingPeriod || 7 * 24 * 60 * 60 * 1000),
        votes: {},
        results: null
      };
      
      // Store proposal
      await this.governanceDb.put(`proposal:${proposalId}`, JSON.stringify(proposal));
      
      // Add to active proposals
      this.activeProposals.set(proposalId, proposal);
      
      this.logger.info(`Created proposal: ${proposalId}`);
      return proposal;
    } catch (err) {
      this.logger.error('Failed to create proposal:', err);
      throw err;
    }
  }
  
  /**
   * Vote on a proposal
   */
  async castVote(proposalId, voterId, vote, weight = 1) {
    try {
      // Get proposal
      let proposal;
      
      if (this.activeProposals.has(proposalId)) {
        proposal = this.activeProposals.get(proposalId);
      } else {
        const proposalJson = await this.governanceDb.get(`proposal:${proposalId}`);
        proposal = JSON.parse(proposalJson);
      }
      
      // Check if proposal is active
      if (proposal.status !== 'active') {
        throw new Error(`Proposal ${proposalId} is not active`);
      }
      
      // Check if voting period has ended
      if (Date.now() > proposal.endsAt) {
        throw new Error(`Voting period for proposal ${proposalId} has ended`);
      }
      
      // Check if voter has already voted
      if (proposal.votes[voterId]) {
        throw new Error(`Voter ${voterId} has already voted on proposal ${proposalId}`);
      }
      
      // Validate vote
      if (!proposal.options.includes(vote)) {
        throw new Error(`Invalid vote option: ${vote}`);
      }
      
      // Record vote
      proposal.votes[voterId] = {
        option: vote,
        weight,
        timestamp: Date.now()
      };
      
      // Update proposal
      await this.governanceDb.put(`proposal:${proposalId}`, JSON.stringify(proposal));
      
      // Update in memory
      if (this.activeProposals.has(proposalId)) {
        this.activeProposals.set(proposalId, proposal);
      }
      
      this.logger.info(`Vote cast by ${voterId} on proposal ${proposalId}: ${vote}`);
      return { success: true, proposal };
    } catch (err) {
      this.logger.error(`Failed to cast vote on proposal ${proposalId}:`, err);
      throw err;
    }
  }
  
  /**
   * Get proposal details
   */
  async getProposal(proposalId) {
    try {
      // Check in-memory cache first
      if (this.activeProposals.has(proposalId)) {
        return this.activeProposals.get(proposalId);
      }
      
      // Get from database
      const proposalJson = await this.governanceDb.get(`proposal:${proposalId}`);
      return JSON.parse(proposalJson);
    } catch (err) {
      this.logger.error(`Failed to get proposal ${proposalId}:`, err);
      throw err;
    }
  }
  
  /**
   * List proposals
   */
  async listProposals(status = 'all', limit = 20, offset = 0) {
    try {
      const proposals = [];
      
      return new Promise((resolve, reject) => {
        this.governanceDb.createReadStream({
          gte: 'proposal:',
          lte: 'proposal:\uffff'
        })
        .on('data', (data) => {
          const proposal = JSON.parse(data.value);
          if (status === 'all' || proposal.status === status) {
            proposals.push(proposal);
          }
        })
        .on('error', (err) => {
          this.logger.error('Error listing proposals:', err);
          reject(err);
        })
        .on('end', () => {
          // Sort by creation date (newest first) and apply pagination
          const sorted = proposals.sort((a, b) => b.createdAt - a.createdAt);
          const paginated = sorted.slice(offset, offset + limit);
          resolve({
            proposals: paginated,
            total: proposals.length,
            limit,
            offset
          });
        });
      });
    } catch (err) {
      this.logger.error('Failed to list proposals:', err);
      throw err;
    }
  }
  
  /**
   * Finalize a proposal (count votes and determine outcome)
   */
  async finalizeProposal(proposalId) {
    try {
      // Get proposal
      let proposal;
      
      if (this.activeProposals.has(proposalId)) {
        proposal = this.activeProposals.get(proposalId);
      } else {
        const proposalJson = await this.governanceDb.get(`proposal:${proposalId}`);
        proposal = JSON.parse(proposalJson);
      }
      
      // Check if proposal is active
      if (proposal.status !== 'active') {
        throw new Error(`Proposal ${proposalId} is already finalized`);
      }
      
      // Calculate results
      const results = this._countVotes(proposal);
      
      // Determine outcome
      const winningOption = this._determineOutcome(results, proposal.type);
      
      // Update proposal
      proposal.status = 'finalized';
      proposal.results = results;
      proposal.outcome = winningOption;
      proposal.finalizedAt = Date.now();
      
      // Save updated proposal
      await this.governanceDb.put(`proposal:${proposalId}`, JSON.stringify(proposal));
      
      // Remove from active proposals
      this.activeProposals.delete(proposalId);
      
      this.logger.info(`Finalized proposal ${proposalId}, outcome: ${winningOption}`);
      return proposal;
    } catch (err) {
      this.logger.error(`Failed to finalize proposal ${proposalId}:`, err);
      throw err;
    }
  }
  
  /**
   * Count votes for a proposal
   */
  _countVotes(proposal) {
    const results = {};
    let totalVotes = 0;
    let totalWeight = 0;
    
    // Initialize results with zero for each option
    proposal.options.forEach(option => {
      results[option] = { votes: 0, weight: 0 };
    });
    
    // Count votes
    Object.entries(proposal.votes).forEach(([voterId, vote]) => {
      const option = vote.option;
      const weight = vote.weight || 1;
      
      results[option].votes += 1;
      results[option].weight += weight;
      
      totalVotes += 1;
      totalWeight += weight;
    });
    
    // Calculate percentages
    proposal.options.forEach(option => {
      results[option].percentage = totalVotes > 0 
        ? (results[option].votes / totalVotes) * 100 
        : 0;
      
      results[option].weightedPercentage = totalWeight > 0 
        ? (results[option].weight / totalWeight) * 100 
        : 0;
    });
    
    return {
      options: results,
      totalVotes,
      totalWeight
    };
  }
  
  /**
   * Determine the winning option based on voting results
   */
  _determineOutcome(results, proposalType) {
    // For simple majority voting
    if (proposalType === 'simple' || proposalType === 'parameter') {
      let highestWeight = 0;
      let winningOption = null;
      
      Object.entries(results.options).forEach(([option, result]) => {
        if (result.weight > highestWeight) {
          highestWeight = result.weight;
          winningOption = option;
        }
      });
      
      return winningOption;
    }
    
    // For super-majority (e.g., protocol changes requiring 2/3 majority)
    if (proposalType === 'protocol') {
      Object.entries(results.options).forEach(([option, result]) => {
        // Check if option has more than 2/3 majority
        if (result.weightedPercentage >= 66.67) {
          return option;
        }
      });
      
      // No option met the threshold
      return 'no consensus';
    }
    
    // Default to simple majority
    let highestWeight = 0;
    let winningOption = null;
    
    Object.entries(results.options).forEach(([option, result]) => {
      if (result.weight > highestWeight) {
        highestWeight = result.weight;
        winningOption = option;
      }
    });
    
    return winningOption;
  }
  
  /**
   * Check for proposals that need to be finalized
   * (Called periodically)
   */
  async checkProposalsForFinalization() {
    const now = Date.now();
    
    for (const [proposalId, proposal] of this.activeProposals.entries()) {
      if (now > proposal.endsAt) {
        try {
          await this.finalizeProposal(proposalId);
        } catch (error) {
          this.logger.error(`Error finalizing proposal ${proposalId}:`, error);
        }
      }
    }
  }
  
  /**
   * Start proposal finalization checker
   */
  startProposalChecker() {
    setInterval(() => {
      this.checkProposalsForFinalization().catch(err => {
        this.logger.error('Error in proposal checker:', err);
      });
    }, 3600000); // Check every hour
  }
}

module.exports = GovernanceSystem;
