/**
 * ICN Storage Module
 * Handles distributed file storage and retrieval
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const crypto = require('crypto');
const level = require('level');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

class StorageManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.storagePath = path.join(process.cwd(), 'data', 'storage');
    this.metadataDb = null;
    
    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    
    // Initialize metadata database
    this._initMetadataDb();
  }
  
  async _initMetadataDb() {
    try {
      const dbPath = path.join(process.cwd(), 'data', 'metadata');
      this.metadataDb = level(dbPath);
      this.logger.info('Storage metadata database initialized');
    } catch (err) {
      this.logger.error('Failed to initialize storage metadata database:', err);
      throw err;
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
      await this.metadataDb.put(`file:${fileId}`, JSON.stringify(metadata));
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
      const metadataJson = await this.metadataDb.get(`file:${fileId}`);
      const metadata = JSON.parse(metadataJson);
      
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
    
    return new Promise((resolve, reject) => {
      this.metadataDb.createReadStream({
        gte: 'file:',
        lte: 'file:\uffff'
      })
      .on('data', (data) => {
        const metadata = JSON.parse(data.value);
        
        // Include if public or user has access
        if (metadata.isPublic || 
            metadata.ownerId === userId || 
            metadata.accessControl.read.includes(userId)) {
          files.push(metadata);
        }
      })
      .on('error', (err) => {
        this.logger.error('Error listing files:', err);
        reject(err);
      })
      .on('end', () => {
        resolve(files);
      });
    });
  }
  
  /**
   * Delete a file
   */
  async deleteFile(fileId, userId) {
    try {
      // Get metadata
      const metadataJson = await this.metadataDb.get(`file:${fileId}`);
      const metadata = JSON.parse(metadataJson);
      
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
      await this.metadataDb.del(`file:${fileId}`);
      
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
      const metadataJson = await this.metadataDb.get(`file:${fileId}`);
      const metadata = JSON.parse(metadataJson);
      
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
      await this.metadataDb.put(`file:${fileId}`, JSON.stringify(metadata));
      
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
   * Initialize replication to peers
   */
  async replicateToNetwork(peers, localFiles) {
    // Implementation would connect to peers and sync files
    // based on replication factor
    this.logger.info('Storage replication initialized');
  }
}

module.exports = StorageManager;
