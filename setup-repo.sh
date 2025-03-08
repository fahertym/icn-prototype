#!/bin/bash
# ICN Prototype Repository Setup Script

set -e

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Setting up ICN Prototype Repository ===${NC}"

# Create directory structure
echo -e "${YELLOW}Creating directory structure...${NC}"
mkdir -p config
mkdir -p data/keys
mkdir -p data/storage
mkdir -p data/metadata
mkdir -p data/credits
mkdir -p data/governance
mkdir -p logs
mkdir -p scripts

# Initialize git repository if not already initialized
if [ ! -d ".git" ]; then
  echo -e "${YELLOW}Initializing git repository...${NC}"
  git init
  
  # Create .gitignore
  cat > .gitignore << 'EOL'
# Node.js
node_modules/
npm-debug.log
yarn-debug.log
yarn-error.log

# Runtime data
data/
logs/
*.log

# Environment variables
.env

# IDE files
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db
EOL
fi

# Create initial README.md if it doesn't exist
if [ ! -f "README.md" ]; then
  echo -e "${YELLOW}Creating README.md...${NC}"
  cat > README.md << 'EOL'
# Intercooperative Network (ICN) Prototype

A prototype implementation of the Hyper-Scalable P2P Cloud Computing platform for the Intercooperative Network.

## Overview

The ICN is a decentralized cloud computing platform built on cooperative principles. This prototype demonstrates the core functionality of the ICN, including:

- P2P node discovery and communication
- Resource sharing and allocation
- Cooperative credit system
- Workload execution and management

## Setup

### Prerequisites

- Node.js 18 or higher
- Docker (for containerized deployment)
- Git

### Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Configure your node in `config/node-config.json`
4. Start the node with `npm start`

## Deployment Options

- **Docker**: Use the provided Dockerfile and docker-compose.yml
- **Proxmox**: Use the scripts in the `scripts` directory to deploy on Proxmox
- **WSL2**: Use the scripts in the `scripts` directory to deploy on Windows with WSL2

## License

AGPL-3.0
EOL
fi

# Create package.json if it doesn't exist
if [ ! -f "package.json" ]; then
  echo -e "${YELLOW}Creating package.json...${NC}"
  cat > package.json << 'EOL'
{
  "name": "icn-node",
  "version": "0.2.0",
  "description": "Enhanced Intercooperative Network Node",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "jest"
  },
  "keywords": [
    "p2p",
    "cloud",
    "cooperative",
    "distributed",
    "decentralized"
  ],
  "author": "ICN Cooperative",
  "license": "AGPL-3.0",
  "dependencies": {
    "express": "^4.18.2",
    "node-fetch": "^2.6.9",
    "uuid": "^9.0.0",
    "winston": "^3.8.2",
    "dockerode": "^3.3.5",
    "socket.io": "^4.6.1",
    "socket.io-client": "^4.6.1",
    "level": "^8.0.0",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.0",
    "multer": "^1.4.5-lts.1",
    "crypto-js": "^4.1.1",
    "libp2p": "^0.45.0",
    "@libp2p/tcp": "^8.0.0",
    "@libp2p/mdns": "^8.0.0",
    "@libp2p/bootstrap": "^8.0.0",
    "@libp2p/kad-dht": "^9.1.0",
    "@libp2p/websockets": "^7.0.0",
    "@chainsafe/libp2p-noise": "^12.0.0",
    "@libp2p/mplex": "^8.0.0"
  },
  "devDependencies": {
    "nodemon": "^2.0.22",
    "jest": "^29.5.0"
  }
}
EOL
fi

# Make the script executable
chmod +x setup-repo.sh

echo -e "${GREEN}Repository setup complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Run ${BLUE}npm install${NC} to install dependencies"
echo -e "2. Create node configuration in ${BLUE}config/node-config.json${NC}"
echo -e "3. Start the node with ${BLUE}npm start${NC}" 