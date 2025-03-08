/**
 * ICN Workload Executor
 * Manages execution of workloads in containers
 */
const Docker = require('dockerode');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class WorkloadExecutor {
  constructor(creditSystem, config, logger) {
    this.creditSystem = creditSystem;
    this.config = config;
    this.logger = logger;
    this.docker = new Docker();
    this.activeWorkloads = new Map();
    
    // Track stats at intervals
    this.statsInterval = null;
    
    // Setup executor
    this._setup();
  }
  
  async _setup() {
    try {
      // Verify Docker connectivity
      const info = await this.docker.info();
      this.logger.info(`Connected to Docker engine: ${info.Name}`);
      
      // Start stats collection
      this._startStatsCollection();
    } catch (err) {
      this.logger.error('Failed to connect to Docker:', err);
      throw err;
    }
  }
  
  /**
   * Execute a workload
   */
  async executeWorkload(workload, consumerId) {
    try {
      // Generate container name
      const containerName = `icn-${workload.id.substring(0, 8)}`;
      
      // Prepare container options
      const containerOptions = {
        Image: workload.image || 'alpine:latest',
        name: containerName,
        Cmd: workload.command,
        Hostname: containerName,
        HostConfig: {
          Memory: this._parseMemory(workload.requirements?.memory?.required || '256MB'),
          CpuPeriod: 100000,
          CpuQuota: (workload.requirements?.cpu?.cores || 1) * 100000,
          RestartPolicy: {
            Name: 'no'
          }
        },
        Env: [
          `WORKLOAD_ID=${workload.id}`,
          `NODE_ID=${this.config.nodeId}`,
          ...(workload.env || [])
        ],
        Labels: {
          'icn.workload.id': workload.id,
          'icn.consumer.id': consumerId,
          'icn.provider.id': this.config.nodeId
        }
      };
      
      // Create container
      const container = await this.docker.createContainer(containerOptions);
      
      // Start resource tracking
      const transactionId = await this.creditSystem.startResourceTracking(
        workload.id,
        consumerId,
        this.config.nodeId
      );
      
      // Start container
      await container.start();
      
      // Get container info
      const containerInfo = await container.inspect();
      
      // Store workload information
      const workloadInfo = {
        workload,
        container,
        containerId: containerInfo.Id,
        startTime: Date.now(),
        transactionId,
        consumerId,
        status: 'running'
      };
      
      this.activeWorkloads.set(workload.id, workloadInfo);
      
      // For short-running commands, wait for completion
      if (workload.waitForCompletion) {
        this.logger.info(`Waiting for workload ${workload.id} to complete`);
        
        // Set up container monitoring
        const stream = await container.logs({
          follow: true,
          stdout: true,
          stderr: true
        });
        
        const logs = [];
        
        stream.on('data', (chunk) => {
          logs.push(chunk.toString('utf8'));
        });
        
        const result = await container.wait();
        
        // Update workload status
        workloadInfo.status = result.StatusCode === 0 ? 'completed' : 'failed';
        workloadInfo.exitCode = result.StatusCode;
        workloadInfo.endTime = Date.now();
        workloadInfo.logs = logs.join('');
        
        // Complete the transaction
        await this.creditSystem.completeTransaction(transactionId);
        
        // Remove workload from active list
        this.activeWorkloads.delete(workload.id);
        
        // Clean up the container
        await container.remove();
        
        return {
          workloadId: workload.id,
          status: workloadInfo.status,
          exitCode: workloadInfo.exitCode,
          logs: workloadInfo.logs
        };
      }
      
      this.logger.info(`Started workload ${workload.id} in container ${containerInfo.Id.substring(0, 12)}`);
      
      return {
        workloadId: workload.id,
        status: 'running',
        containerId: containerInfo.Id
      };
    } catch (err) {
      this.logger.error(`Failed to execute workload ${workload.id}:`, err);
      throw err;
    }
  }
  
  /**
   * Get workload status
   */
  async getWorkloadStatus(workloadId) {
    try {
      // Check if workload is active
      if (this.activeWorkloads.has(workloadId)) {
        const workloadInfo = this.activeWorkloads.get(workloadId);
        
        // Get latest container state
        const containerInfo = await workloadInfo.container.inspect();
        
        return {
          workloadId,
          status: containerInfo.State.Running ? 'running' : containerInfo.State.ExitCode === 0 ? 'completed' : 'failed',
          exitCode: containerInfo.State.ExitCode,
          startTime: workloadInfo.startTime,
          endTime: containerInfo.State.FinishedAt ? new Date(containerInfo.State.FinishedAt).getTime() : null
        };
      }
      
      // Check for container by label
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`icn.workload.id=${workloadId}`]
        }
      });
      
      if (containers.length > 0) {
        const container = this.docker.getContainer(containers[0].Id);
        const containerInfo = await container.inspect();
        
        return {
          workloadId,
          status: containerInfo.State.Running ? 'running' : containerInfo.State.ExitCode === 0 ? 'completed' : 'failed',
          exitCode: containerInfo.State.ExitCode,
          startTime: new Date(containerInfo.State.StartedAt).getTime(),
          endTime: containerInfo.State.FinishedAt ? new Date(containerInfo.State.FinishedAt).getTime() : null
        };
      }
      
      throw new Error(`Workload ${workloadId} not found`);
    } catch (err) {
      this.logger.error(`Failed to get workload status for ${workloadId}:`, err);
      throw err;
    }
  }
  
  /**
   * Stop and remove a workload
   */
  async stopWorkload(workloadId) {
    try {
      // Check if workload is active
      if (this.activeWorkloads.has(workloadId)) {
        const workloadInfo = this.activeWorkloads.get(workloadId);
        
        // Stop container
        await workloadInfo.container.stop();
        
        // Complete transaction
        await this.creditSystem.completeTransaction(workloadInfo.transactionId);
        
        // Remove container
        await workloadInfo.container.remove();
        
        // Remove from active workloads
        this.activeWorkloads.delete(workloadId);
        
        this.logger.info(`Stopped workload ${workloadId}`);
        return true;
      }
      
      // Check for container by label
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`icn.workload.id=${workloadId}`]
        }
      });
      
      if (containers.length > 0) {
        const container = this.docker.getContainer(containers[0].Id);
        
        // Stop container
        await container.stop();
        
        // Remove container
        await container.remove();
        
        this.logger.info(`Stopped workload ${workloadId}`);
        return true;
      }
      
      throw new Error(`Workload ${workloadId} not found`);
    } catch (err) {
      this.logger.error(`Failed to stop workload ${workloadId}:`, err);
      throw err;
    }
  }
  
  /**
   * Get logs for a workload
   */
  async getWorkloadLogs(workloadId) {
    try {
      // Get container
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`icn.workload.id=${workloadId}`]
        }
      });
      
      if (containers.length === 0) {
        throw new Error(`Workload ${workloadId} not found`);
      }
      
      const container = this.docker.getContainer(containers[0].Id);
      
      // Get logs
      const logsBuffer = await container.logs({
        stdout: true,
        stderr: true
      });
      
      return logsBuffer.toString('utf8');
    } catch (err) {
      this.logger.error(`Failed to get logs for workload ${workloadId}:`, err);
      throw err;
    }
  }
  
  /**
   * Start collecting stats for active workloads
   */
  _startStatsCollection() {
    this.statsInterval = setInterval(async () => {
      try {
        for (const [workloadId, workloadInfo] of this.activeWorkloads) {
          try {
            // Get container stats
            const stats = await workloadInfo.container.stats({ stream: false });
            
            // Calculate CPU usage in seconds
            const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
            const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            const cpuUsage = (cpuDelta / systemDelta) * os.cpus().length;
            
            // Calculate memory usage in MB
            const memoryUsageMb = stats.memory_stats.usage / (1024 * 1024);
            
            // Calculate network usage
            let networkRxBytes = 0;
            let networkTxBytes = 0;
            
            if (stats.networks) {
              Object.values(stats.networks).forEach(network => {
                networkRxBytes += network.rx_bytes;
                networkTxBytes += network.tx_bytes;
              });
            }
            
            // Update resource usage in credit system
            await this.creditSystem.updateResourceUsage(workloadInfo.transactionId, {
              cpuSeconds: cpuUsage * 15, // 15 seconds between updates
              memoryMbSeconds: memoryUsageMb * 15,
              bandwidthGb: (networkRxBytes + networkTxBytes) / (1024 * 1024 * 1024)
            });
            
            // Check if container has exited
            const containerInfo = await workloadInfo.container.inspect();
            if (!containerInfo.State.Running) {
              // Container has exited
              workloadInfo.status = containerInfo.State.ExitCode === 0 ? 'completed' : 'failed';
              workloadInfo.exitCode = containerInfo.State.ExitCode;
              workloadInfo.endTime = Date.now();
              
              // Complete the transaction
              await this.creditSystem.completeTransaction(workloadInfo.transactionId);
              
              // Remove workload from active list
              this.activeWorkloads.delete(workloadId);
              
              this.logger.info(`Workload ${workloadId} ${workloadInfo.status} with exit code ${workloadInfo.exitCode}`);
              
              // Clean up the container after some time
              setTimeout(async () => {
                try {
                  await workloadInfo.container.remove();
                } catch (error) {
                  // Ignore errors during cleanup
                }
              }, 60000); // 1 minute
            }
          } catch (error) {
            // Ignore errors for individual containers
            if (error.statusCode === 404) {
              // Container not found, remove from tracking
              this.activeWorkloads.delete(workloadId);
            }
          }
        }
      } catch (err) {
        this.logger.error('Error collecting workload stats:', err);
      }
    }, 15000); // every 15 seconds
  }
  
  /**
   * Parse memory string to bytes
   */
  _parseMemory(memString) {
    const units = {
      'b': 1,
      'kb': 1024,
      'mb': 1024 * 1024,
      'gb': 1024 * 1024 * 1024,
      'tb': 1024 * 1024 * 1024 * 1024
    };
    
    const match = memString.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b)$/);
    if (!match) return 256 * 1024 * 1024; // default to 256MB
    
    const value = parseFloat(match[1]);
    const unit = match[2];
    
    return Math.ceil(value * (units[unit] || 1));
  }
  
  /**
   * Stop the executor
   */
  async stop() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    // Stop all active workloads
    for (const [workloadId, workloadInfo] of this.activeWorkloads) {
      try {
        await workloadInfo.container.stop();
        await this.creditSystem.completeTransaction(workloadInfo.transactionId);
      } catch (error) {
        // Ignore errors during shutdown
      }
    }
    
    this.logger.info('Workload executor stopped');
  }
}

module.exports = WorkloadExecutor;