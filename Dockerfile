FROM node:18-slim

# Install system dependencies including Python and build tools
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Create directory structure for ICN
RUN mkdir -p config data/keys data/storage data/workloads logs

# Copy package files and install dependencies
COPY package.json ./
RUN npm install

# Copy application code
COPY index.js ./
COPY lib/ ./lib/

# Expose ports for P2P networking and API
EXPOSE 9000-9010
EXPOSE 3000

# Set environment variables with defaults
ENV NODE_TYPE=regular \
    NODE_PORT=9000 \
    BOOTSTRAP_NODES="[]" \
    COOPERATIVE_ID="icn-prototype" \
    COOPERATIVE_TIER="contributor"

# Volumes for persistence
VOLUME ["/app/data", "/app/logs"]

# Generate config from environment on startup
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Start the node
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
