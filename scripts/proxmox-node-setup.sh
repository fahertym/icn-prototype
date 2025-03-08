#!/bin/bash
# ICN Proxmox Node Setup Script

set -e

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default values
DEFAULT_VM_ID=9000
DEFAULT_VM_NAME="icn-node"
DEFAULT_MEMORY=2048
DEFAULT_CORES=2
DEFAULT_STORAGE="local-lvm"
DEFAULT_NODE_TYPE="regular"
DEFAULT_NODE_PORT=9000
DEFAULT_BOOTSTRAP_NODES="[]"
DEFAULT_COOPERATIVE_ID="icn-prototype"
DEFAULT_COOPERATIVE_TIER="contributor"

# Parse command line arguments
VM_ID=${1:-$DEFAULT_VM_ID}
VM_NAME=${2:-$DEFAULT_VM_NAME}
MEMORY=${3:-$DEFAULT_MEMORY}
CORES=${4:-$DEFAULT_CORES}
STORAGE=${5:-$DEFAULT_STORAGE}
NODE_TYPE=${6:-$DEFAULT_NODE_TYPE}
NODE_PORT=${7:-$DEFAULT_NODE_PORT}
BOOTSTRAP_NODES=${8:-$DEFAULT_BOOTSTRAP_NODES}
COOPERATIVE_ID=${9:-$DEFAULT_COOPERATIVE_ID}
COOPERATIVE_TIER=${10:-$DEFAULT_COOPERATIVE_TIER}

# Print usage information
usage() {
  echo "Usage: $0 [VM_ID] [VM_NAME] [MEMORY] [CORES] [STORAGE] [NODE_TYPE] [NODE_PORT] [BOOTSTRAP_NODES] [COOPERATIVE_ID] [COOPERATIVE_TIER]"
  echo ""
  echo "Arguments:"
  echo "  VM_ID            - Proxmox VM ID (default: $DEFAULT_VM_ID)"
  echo "  VM_NAME          - VM name (default: $DEFAULT_VM_NAME)"
  echo "  MEMORY           - Memory in MB (default: $DEFAULT_MEMORY)"
  echo "  CORES            - CPU cores (default: $DEFAULT_CORES)"
  echo "  STORAGE          - Storage pool (default: $DEFAULT_STORAGE)"
  echo "  NODE_TYPE        - Node type: bootstrap or regular (default: $DEFAULT_NODE_TYPE)"
  echo "  NODE_PORT        - P2P port (default: $DEFAULT_NODE_PORT)"
  echo "  BOOTSTRAP_NODES  - JSON array of bootstrap nodes (default: $DEFAULT_BOOTSTRAP_NODES)"
  echo "  COOPERATIVE_ID   - Cooperative ID (default: $DEFAULT_COOPERATIVE_ID)"
  echo "  COOPERATIVE_TIER - Cooperative tier (default: $DEFAULT_COOPERATIVE_TIER)"
  echo ""
  echo "Example:"
  echo "  $0 9000 icn-bootstrap 4096 4 local-lvm bootstrap 9000 [] icn-prototype founder"
  echo "  $0 9001 icn-node1 2048 2 local-lvm regular 9001 '[\"http://192.168.1.100:3000\"]' icn-prototype contributor"
  exit 1
}

# Check if help is requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
fi

echo -e "${BLUE}=== Setting up ICN Node on Proxmox ===${NC}"
echo -e "${YELLOW}VM ID:${NC} $VM_ID"
echo -e "${YELLOW}VM Name:${NC} $VM_NAME"
echo -e "${YELLOW}Memory:${NC} $MEMORY MB"
echo -e "${YELLOW}Cores:${NC} $CORES"
echo -e "${YELLOW}Storage:${NC} $STORAGE"
echo -e "${YELLOW}Node Type:${NC} $NODE_TYPE"
echo -e "${YELLOW}Node Port:${NC} $NODE_PORT"
echo -e "${YELLOW}Bootstrap Nodes:${NC} $BOOTSTRAP_NODES"
echo -e "${YELLOW}Cooperative ID:${NC} $COOPERATIVE_ID"
echo -e "${YELLOW}Cooperative Tier:${NC} $COOPERATIVE_TIER"

# Check if VM ID already exists
if qm status $VM_ID &>/dev/null; then
  echo -e "${RED}Error: VM with ID $VM_ID already exists.${NC}"
  exit 1
fi

# Download Ubuntu cloud image if not already present
UBUNTU_TEMPLATE="ubuntu-22.04-template"
if ! qm list | grep -q "$UBUNTU_TEMPLATE"; then
  echo -e "${YELLOW}Downloading Ubuntu 22.04 cloud image...${NC}"
  wget -O /tmp/ubuntu-22.04-server-cloudimg-amd64.img https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img
  
  # Create a new VM
  echo -e "${YELLOW}Creating VM template...${NC}"
  qm create 9999 --name $UBUNTU_TEMPLATE --memory 2048 --cores 2 --net0 virtio,bridge=vmbr0
  
  # Import the disk
  qm importdisk 9999 /tmp/ubuntu-22.04-server-cloudimg-amd64.img $STORAGE
  
  # Configure the VM
  qm set 9999 --scsihw virtio-scsi-pci --scsi0 $STORAGE:vm-9999-disk-0
  qm set 9999 --boot c --bootdisk scsi0
  qm set 9999 --ide2 $STORAGE:cloudinit
  qm set 9999 --serial0 socket --vga serial0
  qm set 9999 --agent enabled=1
  
  # Convert to template
  qm template 9999
  
  # Clean up
  rm /tmp/ubuntu-22.04-server-cloudimg-amd64.img
fi

# Clone the template
echo -e "${YELLOW}Cloning VM from template...${NC}"
qm clone 9999 $VM_ID --name $VM_NAME

# Configure VM resources
echo -e "${YELLOW}Configuring VM resources...${NC}"
qm set $VM_ID --memory $MEMORY
qm set $VM_ID --cores $CORES
qm set $VM_ID --agent enabled=1

# Configure cloud-init
echo -e "${YELLOW}Configuring cloud-init...${NC}"
qm set $VM_ID --ipconfig0 ip=dhcp
qm set $VM_ID --sshkeys ~/.ssh/authorized_keys

# Create cloud-init user-data with ICN setup
USER_DATA=$(cat <<EOF
#cloud-config
package_update: true
package_upgrade: true
packages:
  - curl
  - git
  - nodejs
  - npm
  - docker.io
  - docker-compose

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - usermod -aG docker ubuntu
  - mkdir -p /home/ubuntu/icn-node
  - cd /home/ubuntu/icn-node
  - git clone https://github.com/icn-cooperative/icn-prototype.git .
  - npm install
  - mkdir -p config
  - cat > config/node-config.json << 'EOL'
{
  "nodeType": "${NODE_TYPE}",
  "network": {
    "listenAddresses": ["/ip4/0.0.0.0/tcp/${NODE_PORT}"],
    "bootstrapNodes": ${BOOTSTRAP_NODES}
  },
  "resources": {
    "cpu": {
      "cores": ${CORES},
      "speed": "auto"
    },
    "memory": {
      "total": ${MEMORY},
      "available": "auto"
    },
    "storage": {
      "total": "auto",
      "available": "auto"
    },
    "network": {
      "uplink": "auto",
      "downlink": "auto",
      "latency": "auto"
    }
  },
  "cooperative": {
    "id": "${COOPERATIVE_ID}",
    "tier": "${COOPERATIVE_TIER}"
  },
  "security": {
    "allowAnonymousWorkloads": true,
    "trustLevel": "prototype"
  },
  "logging": {
    "level": "info",
    "file": "logs/icn-node.log"
  }
}
EOL
  - cat > /etc/systemd/system/icn-node.service << 'EOL'
[Unit]
Description=ICN Node
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/icn-node
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=icn-node
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL
  - systemctl enable icn-node
  - systemctl start icn-node
  - echo "ICN Node setup complete"

final_message: "ICN Node has been set up and started. Access the API at http://\$PRIVATE_IPV4:3000"
EOF
)

# Write user-data to a temporary file
echo "$USER_DATA" > /tmp/user-data.yml

# Apply user-data
qm set $VM_ID --cicustom "user=local:snippets/user-data.yml"

# Start the VM
echo -e "${YELLOW}Starting VM...${NC}"
qm start $VM_ID

echo -e "${GREEN}ICN Node setup on Proxmox complete!${NC}"
echo -e "${YELLOW}The VM is starting up and will automatically configure the ICN node.${NC}"
echo -e "${YELLOW}You can access the node API at http://<VM_IP>:3000 once it's running.${NC}"
echo -e "${YELLOW}Check VM status with: qm status $VM_ID${NC}"
echo -e "${YELLOW}Get VM IP with: qm guest cmd $VM_ID network-get-interfaces${NC}" 