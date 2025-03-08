/**
 * ICN Storage Module
 * Handles distributed file storage and retrieval
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

class StorageManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.storagePath = path.join(process.cwd(), 'data', 'storage');
    this.metadataDB = new Map(); // fileId -> metadata
    
    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    
    // Load existing metadata
    this._loadMetadata();
  }
  
  async _loadMetadata() {
    try {
      const metadataPath = path.join(process.cwd(), 'data', 'storage-metadata.json');
      
      if (fs.existsSync(metadataPath)) {
        const data = await promisify(fs.readFile)(metadataPath, 'utf8');
        const metadata = JSON.parse(data);
        
        Object.entries(metadata).forEach(([fileId, fileMetadata]) => {
          this.metadataDB.set(fileId, fileMetadata);
        });
        
        this.logger.info(`Loaded metadata for ${this.metadataDB.size} files`);
      }
    } catch (err) {
      this.logger.error('Failed to load storage metadata:', err);
    }
  }
  
  async _saveMetadata() {
    try {
      const metadataPath = path.join(process.cwd(), 'data', 'storage-metadata.json');
      const metadata = Object.fromEntries(this.metadataDB);
      
      await promisify(fs.writeFile)(
        metadataPath, 
        JSON.stringify(metadata, null, 2),
        'utf8'
      );
    } catch (err) {
      this.logger.error('Failed to save storage metadata:', err);
    }
  }
  
  /**
   * Configure multer for file uploads
   */
  getUploadMiddleware() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.storagePath);
      },
      filename: (req, file, cb) => {
        const fileId = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, `${fileId}${extension}`);
      }
    });
    
    return multer({ storage });
  }
  
  /**
   * Store a file with metadata
   */
  async storeFile(file, ownerId, options = {}) {
    try {
      const fileId = path.basename(file.path);
      const fileHash = await this._hashFile(file.path);
      
      const metadata = {
        id: fileId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        hash: fileHash,
        ownerId,
        createdAt: Date.now(),
        replicationFactor: options.replicationFactor || 2,
        isPublic: options.isPublic || false,
        accessControl: options.accessControl || { 
          read: [ownerId], 
          write: [ownerId]
        }
      };
      
      // Store metadata
      this.metadataDB.set(fileId, metadata);
      await this._saveMetadata();
      
      this.logger.info(`File stored: ${fileId}`);
      
      return { 
        fileId, 
        metadata 
      };
    } catch (err) {
      this.logger.error('Failed to store file:', err);
      throw err;
    }
  }
  
  /**
   * Retrieve a file by ID
   */
  async getFile(fileId, userId) {
    try {
      // Get metadata
      const metadata = this.metadataDB.get(fileId);
      
      if (!metadata) {
        throw new Error('File not found');
      }
      
      // Check access permissions
      if (!metadata.isPublic && 
          !metadata.accessControl.read.includes(userId) && 
          metadata.ownerId !== userId) {
        throw new Error('Access denied');
      }
      
      const filePath = path.join(this.storagePath, fileId);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }
      
      return {
        metadata,
        path: filePath
      };
    } catch (err) {
      this.logger.error(`Failed to get file ${fileId}:`, err);
      throw err;
    }
  }
  
  /**
   * List files owned by or accessible to a user
   */
  async listFiles(userId) {
    const files = [];
    
    for (const metadata of this.metadataDB.values()) {
      // Include if public or user has access
      if (metadata.isPublic || 
          metadata.ownerId === userId || 
          metadata.accessControl.read.includes(userId)) {
        files.push(metadata);
      }
    }
    
    return files;
  }
  
  /**
   * Delete a file
   */
  async deleteFile(fileId, userId) {
    try {
      // Get metadata
      const metadata = this.metadataDB.get(fileId);
      
      if (!metadata) {
        throw new Error('File not found');
      }
      
      // Check write permissions
      if (metadata.ownerId !== userId && 
          !metadata.accessControl.write.includes(userId)) {
        throw new Error('Access denied');
      }
      
      const filePath = path.join(this.storagePath, fileId);
      
      // Delete file
      if (fs.existsSync(filePath)) {
        await promisify(fs.unlink)(filePath);
      }
      
      // Delete metadata
      this.metadataDB.delete(fileId);
      await this._saveMetadata();
      
      this.logger.info(`File deleted: ${fileId}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to delete file ${fileId}:`, err);
      throw err;
    }
  }
  
  /**
   * Share a file with another user
   */
  async shareFile(fileId, ownerId, targetUserId, permissions = ['read']) {
    try {
      // Get metadata
      const metadata = this.metadataDB.get(fileId);
      
      if (!metadata) {
        throw new Error('File not found');
      }
      
      // Verify ownership
      if (metadata.ownerId !== ownerId) {
        throw new Error('Only the owner can share files');
      }
      
      // Update access control
      permissions.forEach(permission => {
        if (!metadata.accessControl[permission].includes(targetUserId)) {
          metadata.accessControl[permission].push(targetUserId);
        }
      });
      
      // Save updated metadata
      this.metadataDB.set(fileId, metadata);
      await this._saveMetadata();
      
      this.logger.info(`File ${fileId} shared with ${targetUserId}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to share file ${fileId}:`, err);
      throw err;
    }
  }
  
  /**
   * Calculate file hash for integrity verification
   */
  async _hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => {
        hash.update(data);
      });
      
      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  /**
   * Distribute file to peers for replication
   */
  async replicateFile(fileId, peers) {
    try {
      const metadata = this.metadataDB.get(fileId);
      if (!metadata) {
        throw new Error(`File not found: ${fileId}`);
      }
      
      const filePath = path.join(this.storagePath, fileId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File data not found: ${fileId}`);
      }
      
      // Select peers for replication based on replication factor
      const targetPeers = this._selectReplicationPeers(peers, metadata.replicationFactor);
      
      this.logger.info(`Replicating file ${fileId} to ${targetPeers.length} peers`);
      
      // Keep track of successful replications
      const successfulReplications = [];
      
      // Read file content
      const fileContent = await promisify(fs.readFile)(filePath);
      
      // Send file to each target peer
      for (const peer of targetPeers) {
        try {
          const formData = new FormData();
          formData.append('file', new Blob([fileContent]), metadata.originalName);
          formData.append('metadata', JSON.stringify({
            isReplica: true,
            originalOwner: metadata.ownerId,
            isPublic: metadata.isPublic,
            sourceNode: this.config.nodeId
          }));
          
          const response = await fetch(`${peer.apiEndpoint}/api/storage/replicate`, {
            method: 'POST',
            body: formData
          });
          
          if (response.ok) {
            const result = await response.json();
            successfulReplications.push({
              peerId: peer.id,
              replicaId: result.fileId
            });
          } else {
            this.logger.warn(`Failed to replicate file ${fileId} to peer ${peer.id}: ${response.statusText}`);
          }
        } catch (err) {
          this.logger.error(`Error replicating file to peer ${peer.id}:`, err);
        }
      }
      
      // Update metadata with replication info
      metadata.replicas = successfulReplications;
      this.metadataDB.set(fileId, metadata);
      await this._saveMetadata();
      
      return {
        fileId,
        replicatedTo: successfulReplications
      };
    } catch (err) {
      this.logger.error(`Failed to replicate file ${fileId}:`, err);
      throw err;
    }
  }
  
  /**
   * Select peers for replication
   */
  _selectReplicationPeers(peers, replicationFactor) {
    // Convert peers Map to array
    const peersArray = Array.from(peers.values());
    
    // Shuffle array to randomize selection
    const shuffled = peersArray.sort(() => 0.5 - Math.random());
    
    // Take the first N peers based on replication factor
    return shuffled.slice(0, replicationFactor);
  }
}

module.exports = StorageManager;