#!/bin/bash
set -e

# Generate config.json using environment variables
generate_config() {
  echo "Generating node configuration..."
  cat > /app/config/node-config.json << EOF2
{
  "nodeType": "${NODE_TYPE}",
  "network": {
    "listenAddresses": ["/ip4/0.0.0.0/tcp/${NODE_PORT}"],
    "bootstrapNodes": ${BOOTSTRAP_NODES}
  },
  "resources": {
    "cpu": {
      "cores": "auto",
      "speed": "auto"
    },
    "memory": {
      "total": "auto",
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
    "level": "${LOG_LEVEL:-info}",
    "file": "logs/icn-node.log"
  }
}
EOF2
}

# Print node information
print_node_info() {
  echo "====================================="
  echo "ICN Node Information:"
  echo "Node Type: ${NODE_TYPE}"
  echo "Port: ${NODE_PORT}"
  echo "Cooperative: ${COOPERATIVE_ID} (${COOPERATIVE_TIER})"
  if [ "${NODE_TYPE}" == "bootstrap" ]; then
    echo "This is a bootstrap node"
  else
    echo "Bootstrap nodes: ${BOOTSTRAP_NODES}"
  fi
  echo "====================================="
}

# Create necessary directories
create_directories() {
  mkdir -p /app/config
  mkdir -p /app/data/keys
  mkdir -p /app/data/storage
  mkdir -p /app/data/metadata
  mkdir -p /app/data/credits
  mkdir -p /app/data/governance
  mkdir -p /app/logs
}

# Main function
main() {
  create_directories
  generate_config
  print_node_info
  
  # Set HOST environment variable
  export HOST=$(hostname -i)
  
  # Execute the CMD
  exec "$@"
}

# Run main function
main "$@"
