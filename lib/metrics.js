/**
 * ICN Metrics System - Simplified Version
 * Collects and exposes system performance metrics
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

class MetricsSystem {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.metrics = {
      system: {},
      network: {},
      resources: {},
      workloads: {},
      storage: {},
      history: []
    };
    
    this.collectionIntervals = {
      fast: null, // 5 seconds
      medium: null, // 30 seconds
      slow: null // 5 minutes
    };
  }
  
  /**
   * Start metrics collection
   */
  startCollection() {
    // Fast metrics (collected every 5 seconds)
    this.collectionIntervals.fast = setInterval(async () => {
      try {
        await this._collectFastMetrics();
      } catch (err) {
        this.logger.error('Error collecting fast metrics:', err);
      }
    }, 5000);
    
    // Medium metrics (collected every 30 seconds)
    this.collectionIntervals.medium = setInterval(async () => {
      try {
        await this._collectMediumMetrics();
      } catch (err) {
        this.logger.error('Error collecting medium metrics:', err);
      }
    }, 30000);
    
    // Slow metrics (collected every 5 minutes)
    this.collectionIntervals.slow = setInterval(async () => {
      try {
        await this._collectSlowMetrics();
        
        // Archive current metrics to history
        this._archiveMetrics();
      } catch (err) {
        this.logger.error('Error collecting slow metrics:', err);
      }
    }, 300000);
    
    // Perform initial collection
    this._collectAllMetrics().catch(err => {
      this.logger.error('Error in initial metrics collection:', err);
    });
    
    this.logger.info('Metrics collection started');
  }
  
  /**
   * Collect fast-changing metrics (CPU, memory)
   */
  async _collectFastMetrics() {
    // System metrics
    this.metrics.system.cpuLoad = os.loadavg();
    this.metrics.system.cpuUsage = await this._getCpuUsage();
    this.metrics.system.memoryTotal = os.totalmem();
    this.metrics.system.memoryFree = os.freemem();
    this.metrics.system.memoryUsed = os.totalmem() - os.freemem();
    this.metrics.system.memoryUsagePercent = (this.metrics.system.memoryUsed / this.metrics.system.memoryTotal) * 100;
    
    // Update resource availability (for workload acceptance)
    this.metrics.resources.availableCpu = os.cpus().length - (this.metrics.system.cpuUsage / 100 * os.cpus().length);
    this.metrics.resources.availableMemory = this.metrics.system.memoryFree;
  }
  
  /**
   * Collect medium-changing metrics (network)
   */
  async _collectMediumMetrics() {
    // Network interfaces
    const interfaces = os.networkInterfaces();
    this.metrics.network.interfaces = interfaces;
    
    // Simple network stats (approximation)
    this.metrics.network.stats = Object.entries(interfaces).map(([name, addresses]) => {
      return {
        name,
        addresses: addresses.map(addr => addr.address)
      };
    });
    
    // Get Docker info if available
    try {
      const docker = require('dockerode');
      const dockerClient = new docker();
      
      const info = await dockerClient.info();
      const containers = await dockerClient.listContainers();
      
      this.metrics.workloads.activeContainers = containers.length;
      this.metrics.workloads.containerInfo = containers.map(c => ({
        id: c.Id.substring(0, 12),
        names: c.Names,
        image: c.Image,
        state: c.State,
        status: c.Status
      }));
    } catch (err) {
      // Docker metrics are optional
      this.metrics.workloads.dockerAvailable = false;
    }
  }
  
  /**
   * Collect slowly-changing metrics (storage, long-term stats)
   */
  async _collectSlowMetrics() {
    // Simple storage check using df output
    try {
      const storagePath = path.join(process.cwd(), 'data', 'storage');
      
      // Use fs.statfs if available or estimate storage
      this.metrics.storage.root = {
        total: 100 * 1024 * 1024 * 1024, // 100GB placeholder
        available: 50 * 1024 * 1024 * 1024, // 50GB placeholder
        used: 50 * 1024 * 1024 * 1024 // 50GB placeholder
      };
      
      // If we need actual storage metrics, can implement that later
      
      this.metrics.resources.availableStorage = this.metrics.storage.root.available;
      this.metrics.resources.storageUsagePercent = 50; // Placeholder
    } catch (err) {
      this.logger.error('Error getting storage metrics:', err);
    }
    
    // System information
    this.metrics.system.uptime = os.uptime();
    this.metrics.system.platform = os.platform();
    this.metrics.system.release = os.release();
    this.metrics.system.hostname = os.hostname();
    
    // Process information
    this.metrics.system.processUptime = process.uptime();
    this.metrics.system.processMemoryUsage = process.memoryUsage();
  }
  
  /**
   * Collect all metrics at once
   */
  async _collectAllMetrics() {
    await this._collectFastMetrics();
    await this._collectMediumMetrics();
    await this._collectSlowMetrics();
  }
  
  /**
   * Archive current metrics to history
   */
  _archiveMetrics() {
    const timestamp = Date.now();
    
    // Create a summary of current metrics
    const summary = {
      timestamp,
      cpu: this.metrics.system.cpuUsage,
      memory: this.metrics.system.memoryUsagePercent,
      storage: this.metrics.resources.storageUsagePercent,
      network: {
        rx: 0, // Placeholder
        tx: 0  // Placeholder
      },
      workloads: this.metrics.workloads.activeContainers || 0
    };
    
    // Add to history, keeping the last 288 entries (24 hours at 5-minute intervals)
    this.metrics.history.unshift(summary);
    if (this.metrics.history.length > 288) {
      this.metrics.history = this.metrics.history.slice(0, 288);
    }
  }
  
  /**
   * Get current CPU usage percentage
   */
  async _getCpuUsage() {
    return new Promise((resolve) => {
      // Get initial measurements
      const startMeasure = this._getCpuInfo();
      
      // Measure again after short delay
      setTimeout(() => {
        const endMeasure = this._getCpuInfo();
        
        // Calculate the difference
        let idleDifference = endMeasure.idle - startMeasure.idle;
        let totalDifference = endMeasure.total - startMeasure.total;
        
        // Calculate CPU usage percentage
        let usagePercent = 100 - (100 * idleDifference / totalDifference);
        
        resolve(usagePercent);
      }, 100);
    });
  }
  
  /**
   * Get CPU info totals
   */
  _getCpuInfo() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    
    return { idle, total };
  }
  
  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: Date.now()
    };
  }
  
  /**
   * Get historical metrics
   */
  getHistoricalMetrics(hours = 24) {
    const entriesPerHour = 12; // 5-minute intervals
    const entries = Math.min(hours * entriesPerHour, this.metrics.history.length);
    
    return {
      history: this.metrics.history.slice(0, entries),
      interval: '5m',
      entries
    };
  }
  
  /**
   * Stop metrics collection
   */
  stopCollection() {
    Object.values(this.collectionIntervals).forEach(interval => {
      if (interval) {
        clearInterval(interval);
      }
    });
    
    this.logger.info('Metrics collection stopped');
  }
}

module.exports = MetricsSystem;
