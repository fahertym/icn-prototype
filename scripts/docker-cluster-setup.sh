#!/bin/bash
# ICN Docker Cluster Setup Script
# Creates a multi-node ICN cluster for local development and testing

set -e

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Setting up ICN Docker Cluster ===${NC}"

# Check for Docker and Docker Compose
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

# Default values
DEFAULT_CLUSTER_NAME="icn-cluster"
DEFAULT_NODE_COUNT=3
DEFAULT_BOOTSTRAP_COUNT=1

# Parse command line arguments
CLUSTER_NAME=${1:-$DEFAULT_CLUSTER_NAME}
NODE_COUNT=${2:-$DEFAULT_NODE_COUNT}
BOOTSTRAP_COUNT=${3:-$DEFAULT_BOOTSTRAP_COUNT}

# Print usage information
usage() {
  echo "Usage: $0 [CLUSTER_NAME] [NODE_COUNT] [BOOTSTRAP_COUNT]"
  echo ""
  echo "Arguments:"
  echo "  CLUSTER_NAME     - Name for the cluster (default: $DEFAULT_CLUSTER_NAME)"
  echo "  NODE_COUNT       - Number of regular nodes (default: $DEFAULT_NODE_COUNT)"
  echo "  BOOTSTRAP_COUNT  - Number of bootstrap nodes (default: $DEFAULT_BOOTSTRAP_COUNT)"
  echo ""
  echo "Example:"
  echo "  $0 icn-test 5 2"
  exit 1
}

# Check if help is requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
fi

echo -e "${YELLOW}Cluster Name:${NC} $CLUSTER_NAME"
echo -e "${YELLOW}Regular Nodes:${NC} $NODE_COUNT"
echo -e "${YELLOW}Bootstrap Nodes:${NC} $BOOTSTRAP_COUNT"

# Create cluster directory
CLUSTER_DIR="./clusters/$CLUSTER_NAME"
mkdir -p "$CLUSTER_DIR"

# Create docker-compose.yml
echo -e "${YELLOW}Creating Docker Compose configuration...${NC}"
cat > "$CLUSTER_DIR/docker-compose.yml" << EOF
version: '3.8'

# ICN Cluster: $CLUSTER_NAME
# Bootstrap Nodes: $BOOTSTRAP_COUNT
# Regular Nodes: $NODE_COUNT

services:
EOF

# Add bootstrap nodes
for ((i=1; i<=$BOOTSTRAP_COUNT; i++)); do
  NODE_NAME="bootstrap$i"
  P2P_PORT=$((9000 + i - 1))
  API_PORT=$((3000 + i - 1))
  
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
  # Bootstrap node $i
  $NODE_NAME:
    build:
      context: ../..
      dockerfile: Dockerfile
    image: icn-node:latest
    container_name: ${CLUSTER_NAME}-${NODE_NAME}
    environment:
      - NODE_TYPE=bootstrap
      - NODE_PORT=$P2P_PORT
      - BOOTSTRAP_NODES=[]
      - COOPERATIVE_ID=${CLUSTER_NAME}
      - COOPERATIVE_TIER=founder
      - LOG_LEVEL=info
    ports:
      - "$P2P_PORT:$P2P_PORT"
      - "$API_PORT:3000"
    volumes:
      - ${NODE_NAME}-data:/app/data
      - ${NODE_NAME}-logs:/app/logs
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
    networks:
      - icn-network

EOF
done

# Create bootstrap node list for regular nodes
BOOTSTRAP_LIST="["
for ((i=1; i<=$BOOTSTRAP_COUNT; i++)); do
  NODE_NAME="bootstrap$i"
  if [ $i -gt 1 ]; then
    BOOTSTRAP_LIST+=", "
  fi
  BOOTSTRAP_LIST+="\"http://$NODE_NAME:3000\""
done
BOOTSTRAP_LIST+="]"

# Add regular nodes
for ((i=1; i<=$NODE_COUNT; i++)); do
  NODE_NAME="node$i"
  P2P_PORT=$((9100 + i - 1))
  API_PORT=$((3100 + i - 1))
  
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
  # Regular node $i
  $NODE_NAME:
    image: icn-node:latest
    container_name: ${CLUSTER_NAME}-${NODE_NAME}
    depends_on:
EOF

  # Add bootstrap node dependencies
  for ((j=1; j<=$BOOTSTRAP_COUNT; j++)); do
    cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
      - bootstrap$j
EOF
  done

  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
    environment:
      - NODE_TYPE=regular
      - NODE_PORT=$P2P_PORT
      - BOOTSTRAP_NODES=$BOOTSTRAP_LIST
      - COOPERATIVE_ID=${CLUSTER_NAME}
      - COOPERATIVE_TIER=contributor
      - LOG_LEVEL=info
    ports:
      - "$P2P_PORT:$P2P_PORT"
      - "$API_PORT:3000"
    volumes:
      - ${NODE_NAME}-data:/app/data
      - ${NODE_NAME}-logs:/app/logs
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
    networks:
      - icn-network

EOF
done

# Add dashboard service
cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
  # Web dashboard
  dashboard:
    image: nginx:alpine
    container_name: ${CLUSTER_NAME}-dashboard
    depends_on:
EOF

# Add node dependencies for dashboard
for ((i=1; i<=$BOOTSTRAP_COUNT; i++)); do
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
      - bootstrap$i
EOF
done

for ((i=1; i<=$NODE_COUNT; i++)); do
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
      - node$i
EOF
done

cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
    ports:
      - "8080:80"
    volumes:
      - ../../dashboard:/usr/share/nginx/html
    restart: unless-stopped
    networks:
      - icn-network

networks:
  icn-network:
    name: ${CLUSTER_NAME}-network
    driver: bridge

volumes:
EOF

# Add volumes for bootstrap nodes
for ((i=1; i<=$BOOTSTRAP_COUNT; i++)); do
  NODE_NAME="bootstrap$i"
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
  ${NODE_NAME}-data:
  ${NODE_NAME}-logs:
EOF
done

# Add volumes for regular nodes
for ((i=1; i<=$NODE_COUNT; i++)); do
  NODE_NAME="node$i"
  cat >> "$CLUSTER_DIR/docker-compose.yml" << EOF
  ${NODE_NAME}-data:
  ${NODE_NAME}-logs:
EOF
done

# Create cluster management script
echo -e "${YELLOW}Creating cluster management script...${NC}"
cat > "$CLUSTER_DIR/manage-cluster.sh" << 'EOF'
#!/bin/bash
# ICN Cluster Management Script

set -e

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print usage information
usage() {
  echo "Usage: $0 [COMMAND]"
  echo ""
  echo "Commands:"
  echo "  start       - Start the cluster"
  echo "  stop        - Stop the cluster"
  echo "  restart     - Restart the cluster"
  echo "  status      - Show the status of all nodes"
  echo "  logs [node] - Show logs for a specific node or all nodes"
  echo "  build       - Rebuild the node image"
  echo "  clean       - Remove all containers and volumes"
  echo ""
  exit 1
}

# Check command
if [ $# -lt 1 ]; then
  usage
fi

COMMAND=$1
NODE=$2

case "$COMMAND" in
  start)
    echo -e "${BLUE}Starting ICN cluster...${NC}"
    docker-compose up -d
    echo -e "${GREEN}Cluster started successfully.${NC}"
    ;;
    
  stop)
    echo -e "${BLUE}Stopping ICN cluster...${NC}"
    docker-compose stop
    echo -e "${GREEN}Cluster stopped successfully.${NC}"
    ;;
    
  restart)
    echo -e "${BLUE}Restarting ICN cluster...${NC}"
    docker-compose restart
    echo -e "${GREEN}Cluster restarted successfully.${NC}"
    ;;
    
  status)
    echo -e "${BLUE}ICN cluster status:${NC}"
    docker-compose ps
    ;;
    
  logs)
    if [ -z "$NODE" ]; then
      echo -e "${BLUE}Showing logs for all nodes...${NC}"
      docker-compose logs --tail=100 -f
    else
      echo -e "${BLUE}Showing logs for $NODE...${NC}"
      docker-compose logs --tail=100 -f "$NODE"
    fi
    ;;
    
  build)
    echo -e "${BLUE}Building ICN node image...${NC}"
    docker-compose build
    echo -e "${GREEN}Image built successfully.${NC}"
    ;;
    
  clean)
    echo -e "${RED}Removing all containers and volumes...${NC}"
    docker-compose down -v
    echo -e "${GREEN}Cleanup completed successfully.${NC}"
    ;;
    
  *)
    echo -e "${RED}Unknown command: $COMMAND${NC}"
    usage
    ;;
esac
EOF

# Make cluster management script executable
chmod +x "$CLUSTER_DIR/manage-cluster.sh"

# Create README for the cluster
echo -e "${YELLOW}Creating cluster README...${NC}"
cat > "$CLUSTER_DIR/README.md" << EOF
# ICN Cluster: $CLUSTER_NAME

This is an ICN cluster with $BOOTSTRAP_COUNT bootstrap node(s) and $NODE_COUNT regular node(s).

## Network Configuration

- Bootstrap Node(s): $BOOTSTRAP_COUNT
- Regular Node(s): $NODE_COUNT
- Dashboard: http://localhost:8080

## Management

Use the \`manage-cluster.sh\` script to control the cluster:

\`\`\`
./manage-cluster.sh start    # Start the cluster
./manage-cluster.sh stop     # Stop the cluster
./manage-cluster.sh status   # Check cluster status
./manage-cluster.sh logs     # View logs
\`\`\`

## API Access

EOF

# Add API access info to README
for ((i=1; i<=$BOOTSTRAP_COUNT; i++)); do
  NODE_NAME="bootstrap$i"
  API_PORT=$((3000 + i - 1))
  echo "- Bootstrap Node $i API: http://localhost:$API_PORT" >> "$CLUSTER_DIR/README.md"
done

for ((i=1; i<=$NODE_COUNT; i++)); do
  NODE_NAME="node$i"
  API_PORT=$((3100 + i - 1))
  echo "- Regular Node $i API: http://localhost:$API_PORT" >> "$CLUSTER_DIR/README.md"
done

echo -e "${GREEN}ICN Docker Cluster setup complete!${NC}"
echo -e "${YELLOW}Navigate to $CLUSTER_DIR and run ./manage-cluster.sh start to launch the cluster.${NC}"
echo -e "${YELLOW}Access the dashboard at http://localhost:8080 once the cluster is running.${NC}" 