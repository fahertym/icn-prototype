// ICN Node Implementation - Simplified HTTP Version
const fs = require('fs');
const path = require('path');
const express = require('express');
const winston = require('winston');
const os = require('os');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'icn-node' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/icn-node.log' 
    })
  ]
});

class ICNNode {
  constructor() {
    this.nodeId = null;
    this.resources = null;
    this.config = null;
    this.workloads = new Map();
    this.knownPeers = new Map(); // Map of peer IDs to peer info
    this.discoveryInterval = null;
    this.resourceBroadcastInterval = null;
    this.apiServer = null;
  }

  async init() {
    try {
      // Load configuration
      this.config = this._loadConfig();
      logger.info(`Starting ICN node (${this.config.nodeType})`);
      
      // Load or create node ID
      this.nodeId = this._loadOrCreateNodeId();
      logger.info(`Node ID: ${this.nodeId}`);
      
      // Detect system resources
      this.resources = this._detectResources();
      logger.info('Resources detected:', this.resources);
      
      // Setup API server
      this._setupApiServer();
      
      // Start discovery if not bootstrap node
      if (this.config.nodeType !== 'bootstrap' && this.config.network.bootstrapNodes.length > 0) {
        this._startDiscovery();
      }
      
      // Start resource broadcasting
      this._startResourceBroadcasting();
      
      // Setup shutdown handlers
      this._setupShutdownHandlers();
      
      return this;
    } catch (error) {
      logger.error('Failed to initialize ICN node:', error);
      throw error;
    }
  }
  
  _loadConfig() {
    const configPath = path.join(__dirname, 'config', 'node-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  
  _loadOrCreateNodeId() {
    const nodeIdPath = path.join(__dirname, 'data', 'keys', 'node-id.json');
    
    if (fs.existsSync(nodeIdPath)) {
      const nodeIdJson = JSON.parse(fs.readFileSync(nodeIdPath, 'utf8'));
      return nodeIdJson.id;
    } else {
      // Create a new node ID
      const nodeId = uuidv4();
      const nodeIdJson = { id: nodeId, createdAt: new Date().toISOString() };
      
      // Ensure directory exists
      const keysDir = path.join(__dirname, 'data', 'keys');
      if (!fs.existsSync(keysDir)) {
        fs.mkdirSync(keysDir, { recursive: true });
      }
      
      fs.writeFileSync(nodeIdPath, JSON.stringify(nodeIdJson, null, 2));
      return nodeId;
    }
  }
  
  _detectResources() {
    const resources = this.config.resources;
    
    // Detect CPU
    if (resources.cpu.cores === "auto") {
      resources.cpu.cores = os.cpus().length;
    }
    if (resources.cpu.speed === "auto") {
      resources.cpu.speed = `${Math.round(os.cpus()[0].speed / 100) / 10}GHz`;
    }
    
    // Detect memory
    if (resources.memory.total === "auto") {
      resources.memory.total = `${Math.floor(os.totalmem() / (1024 * 1024))}MB`;
    }
    if (resources.memory.available === "auto") {
      resources.memory.available = `${Math.floor(os.freemem() / (1024 * 1024))}MB`;
    }
    
    // For storage, we would need a proper library to get accurate disk space
    // This is a placeholder
    if (resources.storage.total === "auto") {
      resources.storage.total = "100GB";
    }
    if (resources.storage.available === "auto") {
      resources.storage.available = "50GB";
    }
    
    // Network is hard to detect accurately, using placeholders
    if (resources.network.uplink === "auto") {
      resources.network.uplink = "100Mbps";
    }
    if (resources.network.downlink === "auto") {
      resources.network.downlink = "100Mbps";
    }
    if (resources.network.latency === "auto") {
      resources.network.latency = "20ms";
    }
    
    return resources;
  }
  
  _setupApiServer() {
    const app = express();
    const apiPort = process.env.API_PORT || 3000;
    
    // Enable JSON middleware
    app.use(express.json());
    
    // Status endpoint
    app.get('/api/status', (req, res) => {
      res.json({
        id: this.nodeId,
        uptime: process.uptime(),
        nodeType: this.config.nodeType,
        connections: this.knownPeers.size,
        resources: this.resources,
        workloads: this.workloads.size
      });
    });
    
    // Resource discovery endpoint
    app.get('/api/discovery', (req, res) => {
      res.json({
        id: this.nodeId,
        resources: this.resources,
        nodeType: this.config.nodeType,
        cooperative: this.config.cooperative,
        timestamp: Date.now(),
        apiEndpoint: `http://${req.headers.host}`
      });
    });
    
    // Register peer endpoint
    app.post('/api/peers', (req, res) => {
      const peer = req.body;
      
      if (!peer.id || !peer.apiEndpoint) {
        return res.status(400).json({ error: 'Invalid peer information' });
      }
      
      // Add peer to known peers
      this.knownPeers.set(peer.id, {
        ...peer,
        lastSeen: Date.now()
      });
      
      logger.info(`Registered peer: ${peer.id} at ${peer.apiEndpoint}`);
      
      // Return our information
      res.json({
        id: this.nodeId,
        nodeType: this.config.nodeType,
        resources: this.resources,
        cooperative: this.config.cooperative,
        apiEndpoint: `http://${req.headers.host}`
      });
    });
    
    // Peers endpoint
    app.get('/api/peers', (req, res) => {
      const peers = Array.from(this.knownPeers.values()).map(peer => ({
        id: peer.id,
        nodeType: peer.nodeType,
        apiEndpoint: peer.apiEndpoint,
        lastSeen: peer.lastSeen
      }));
      
      res.json(peers);
    });
    
    // Workloads endpoint
    app.get('/api/workloads', (req, res) => {
      const workloads = Array.from(this.workloads.entries()).map(([id, workload]) => ({
        id,
        ...workload
      }));
      
      res.json(workloads);
    });
    
    // Submit workload endpoint
    app.post('/api/workloads', async (req, res) => {
      try {
        const workload = req.body;
        
        // Validate workload
        if (!workload.id) {
          workload.id = this._generateId();
        }
        
        if (!workload.requirements) {
          workload.requirements = {
            cpu: { cores: 1 },
            memory: { required: '256MB' }
          };
        }
        
        // Check if we can accept it
        const decision = this._canAcceptWorkload(workload);
        
        if (decision.canAccept) {
          // Accept locally
          this.workloads.set(workload.id, {
            ...workload,
            status: 'accepted',
            acceptedAt: Date.now()
          });
          
          res.status(201).json({
            accepted: true,
            workloadId: workload.id,
            nodeId: this.nodeId
          });
        } else {
          // Try to find another node
          const result = await this._findNodeForWorkload(workload);
          
          if (result.success) {
            res.status(200).json({
              accepted: true,
              workloadId: workload.id,
              nodeId: result.nodeId,
              forwardedTo: result.nodeId
            });
          } else {
            res.status(400).json({
              accepted: false,
              reason: result.reason || decision.reason
            });
          }
        }
      } catch (err) {
        logger.error('Error handling workload submission:', err);
        res.status(500).json({
          accepted: false,
          reason: 'Internal server error'
        });
      }
    });
    
    // Start the API server
    this.apiServer = app.listen(apiPort, '0.0.0.0', () => {
      logger.info(`API server listening on port ${apiPort}`);
    });
  }
  
  _startDiscovery() {
    // Function to discover peers from bootstrap nodes
    const discoverPeers = async () => {
      for (const bootstrapNode of this.config.network.bootstrapNodes) {
        try {
          // Make request to bootstrap node
          const bootstrapUrl = bootstrapNode.startsWith('http') ? 
            bootstrapNode : 
            `http://${bootstrapNode}`;
          
          const response = await fetch(`${bootstrapUrl}/api/discovery`);
          
          if (!response.ok) {
            logger.error(`Failed to discover from bootstrap node ${bootstrapNode}: ${response.statusText}`);
            continue;
          }
          
          const bootstrapInfo = await response.json();
          
          // Register with bootstrap node
          const registerResponse = await fetch(`${bootstrapUrl}/api/peers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              id: this.nodeId,
              nodeType: this.config.nodeType,
              resources: this.resources,
              apiEndpoint: `http://${process.env.HOST || 'localhost'}:${process.env.API_PORT || 3000}`
            })
          });
          
          if (!registerResponse.ok) {
            logger.error(`Failed to register with bootstrap node ${bootstrapNode}: ${registerResponse.statusText}`);
            continue;
          }
          
          // Add bootstrap node to known peers
          this.knownPeers.set(bootstrapInfo.id, {
            ...bootstrapInfo,
            lastSeen: Date.now(),
            apiEndpoint: bootstrapUrl
          });
          
          logger.info(`Discovered and registered with bootstrap node: ${bootstrapInfo.id}`);
          
          // Get peers from bootstrap node
          const peersResponse = await fetch(`${bootstrapUrl}/api/peers`);
          
          if (!peersResponse.ok) {
            logger.error(`Failed to get peers from bootstrap node ${bootstrapNode}: ${peersResponse.statusText}`);
            continue;
          }
          
          const peers = await peersResponse.json();
          
          // Add peers to known peers
          for (const peer of peers) {
            if (peer.id !== this.nodeId && !this.knownPeers.has(peer.id)) {
              this.knownPeers.set(peer.id, {
                ...peer,
                lastSeen: Date.now()
              });
              
              logger.info(`Discovered peer: ${peer.id} at ${peer.apiEndpoint}`);
            }
          }
        } catch (err) {
          logger.error(`Error discovering peers from bootstrap node ${bootstrapNode}:`, err);
        }
      }
    };
    
    // First discovery attempt
    discoverPeers().catch(err => {
      logger.error('Error in initial peer discovery:', err);
    });
    
    // Set up discovery interval
    this.discoveryInterval = setInterval(() => {
      discoverPeers().catch(err => {
        logger.error('Error in peer discovery:', err);
      });
    }, 60000); // every minute
  }
  
  _startResourceBroadcasting() {
    // Function to broadcast resources to known peers
    const broadcastResources = async () => {
      // Update available memory
      this.resources.memory.available = `${Math.floor(os.freemem() / (1024 * 1024))}MB`;
      
      // Broadcast to all known peers
      for (const [peerId, peer] of this.knownPeers.entries()) {
        try {
          // Skip if last seen more than 5 minutes ago
          if (Date.now() - peer.lastSeen > 5 * 60 * 1000) {
            continue;
          }
          
          const response = await fetch(`${peer.apiEndpoint}/api/peers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              id: this.nodeId,
              nodeType: this.config.nodeType,
              resources: this.resources,
              apiEndpoint: `http://${process.env.HOST || 'localhost'}:${process.env.API_PORT || 3000}`
            })
          });
          
          if (!response.ok) {
            logger.error(`Failed to broadcast resources to peer ${peerId}: ${response.statusText}`);
            continue;
          }
          
          const peerInfo = await response.json();
          
          // Update peer info
          this.knownPeers.set(peerId, {
            ...peerInfo,
            lastSeen: Date.now(),
            apiEndpoint: peer.apiEndpoint
          });
          
          logger.info(`Broadcasted resources to peer: ${peerId}`);
        } catch (err) {
          logger.error(`Error broadcasting resources to peer ${peerId}:`, err);
        }
      }
    };
    
    // Set up resource broadcasting interval
    this.resourceBroadcastInterval = setInterval(() => {
      broadcastResources().catch(err => {
        logger.error('Error in resource broadcasting:', err);
      });
    }, 60000); // every minute
  }
  
  _canAcceptWorkload(workload) {
    // Simple resource check - in a real implementation this would be much more sophisticated
    const requiredCores = workload.requirements?.cpu?.cores || 1;
    const availableCores = this.resources.cpu.cores - 
      Array.from(this.workloads.values())
        .reduce((total, wl) => total + (wl.requirements?.cpu?.cores || 1), 0);
    
    if (availableCores < requiredCores) {
      return { canAccept: false, reason: 'Insufficient CPU resources' };
    }
    
    // More sophisticated checks would go here
    
    return { canAccept: true, reason: 'Resources available' };
  }
  
  async _findNodeForWorkload(workload) {
    // Try to find another node that can accept the workload
    for (const [peerId, peer] of this.knownPeers.entries()) {
      try {
        // Skip if last seen more than 5 minutes ago
        if (Date.now() - peer.lastSeen > 5 * 60 * 1000) {
          continue;
        }
        
        const response = await fetch(`${peer.apiEndpoint}/api/workloads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(workload)
        });
        
        const result = await response.json();
        
        if (response.ok && result.accepted) {
          logger.info(`Workload ${workload.id} accepted by peer ${peerId}`);
          return {
            success: true,
            nodeId: result.nodeId,
            workloadId: result.workloadId
          };
        }
      } catch (err) {
        logger.error(`Error submitting workload to peer ${peerId}:`, err);
      }
    }
    
    return {
      success: false,
      reason: 'No nodes available to accept workload'
    };
  }
  
  _generateId() {
    return `wl-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }
  
  _setupShutdownHandlers() {
    // Handle shutdown signals
    process.on('SIGINT', async () => {
      await this.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      await this.stop();
      process.exit(0);
    });
  }
  
  async stop() {
    logger.info('Shutting down node...');
    
    // Clear intervals
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }
    
    if (this.resourceBroadcastInterval) {
      clearInterval(this.resourceBroadcastInterval);
    }
    
    // Close the API server
    if (this.apiServer) {
      await new Promise(resolve => this.apiServer.close(resolve));
    }
    
    logger.info('Node shutdown complete');
  }
}

// Start the node
async function main() {
  try {
    const node = new ICNNode();
    await node.init();
    logger.info('ICN node initialized successfully');
  } catch (err) {
    logger.error('Failed to start ICN node:', err);
    process.exit(1);
  }
}

// Run the main function
main();
