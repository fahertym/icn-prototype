# ICN Node Setup Script for WSL2
# This script creates a new WSL2 Ubuntu distribution and sets up an ICN node

# Parameters
param (
    [string]$DistroName = "icn-node",
    [string]$NodeType = "regular",
    [int]$NodePort = 9001,
    [string]$BootstrapNodes = '["http://192.168.1.100:3000"]',
    [string]$CooperativeId = "icn-prototype",
    [string]$CooperativeTier = "contributor",
    [string]$InstallDir = "$env:USERPROFILE\icn-prototype"
)

# Display banner
Write-Host "===== ICN Node Setup for WSL2 =====" -ForegroundColor Cyan
Write-Host "Distribution Name: $DistroName" -ForegroundColor Yellow
Write-Host "Node Type: $NodeType" -ForegroundColor Yellow
Write-Host "Node Port: $NodePort" -ForegroundColor Yellow
Write-Host "Bootstrap Nodes: $BootstrapNodes" -ForegroundColor Yellow
Write-Host "Cooperative ID: $CooperativeId" -ForegroundColor Yellow
Write-Host "Cooperative Tier: $CooperativeTier" -ForegroundColor Yellow
Write-Host "Installation Directory: $InstallDir" -ForegroundColor Yellow
Write-Host ""

# Check if WSL is installed
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    Write-Host "WSL is not installed. Installing WSL..." -ForegroundColor Red
    wsl --install
    Write-Host "Please restart your computer and run this script again." -ForegroundColor Yellow
    exit
}

# Check if the distribution already exists
$existingDistros = wsl --list
if ($existingDistros -match $DistroName) {
    Write-Host "A WSL distribution named '$DistroName' already exists." -ForegroundColor Red
    $response = Read-Host "Do you want to remove it and create a new one? (y/n)"
    if ($response -eq "y") {
        Write-Host "Removing existing distribution..." -ForegroundColor Yellow
        wsl --unregister $DistroName
    } else {
        Write-Host "Setup cancelled." -ForegroundColor Red
        exit
    }
}

# Create installation directory
if (-not (Test-Path $InstallDir)) {
    Write-Host "Creating installation directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

# Download Ubuntu image
$ubuntuAppx = "$env:TEMP\ubuntu.appx"
if (-not (Test-Path $ubuntuAppx)) {
    Write-Host "Downloading Ubuntu image..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://aka.ms/wslubuntu2204" -OutFile $ubuntuAppx -UseBasicParsing
}

# Extract Ubuntu image
Write-Host "Extracting Ubuntu image..." -ForegroundColor Yellow
Expand-Archive -Path $ubuntuAppx -DestinationPath "$env:TEMP\ubuntu" -Force

# Import the distribution
Write-Host "Importing Ubuntu distribution as '$DistroName'..." -ForegroundColor Yellow
wsl --import $DistroName $InstallDir "$env:TEMP\ubuntu\install.tar.gz"

# Create setup script
$setupScript = @"
#!/bin/bash
# ICN Node Setup Script for WSL2

# Update and install dependencies
echo "Updating system and installing dependencies..."
apt update && apt upgrade -y
apt install -y curl git nodejs npm docker.io docker-compose

# Start Docker service
echo "Starting Docker service..."
service docker start

# Create ICN directory structure
echo "Creating ICN directory structure..."
mkdir -p ~/icn-node
cd ~/icn-node
mkdir -p config data/keys data/storage data/metadata data/credits data/governance logs

# Clone repository or create from scratch
if [ -d ".git" ]; then
    echo "Git repository already exists, pulling latest changes..."
    git pull
else
    echo "Initializing git repository..."
    git init
    
    # Create package.json
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

# Install dependencies
echo "Installing Node.js dependencies..."
npm install

# Create node configuration
echo "Creating node configuration..."
cat > config/node-config.json << EOL
{
  "nodeType": "$NodeType",
  "network": {
    "listenAddresses": ["/ip4/0.0.0.0/tcp/$NodePort"],
    "bootstrapNodes": $BootstrapNodes
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
    "id": "$CooperativeId",
    "tier": "$CooperativeTier"
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

# Create systemd service file
echo "Creating systemd service file..."
cat > /etc/systemd/system/icn-node.service << 'EOL'
[Unit]
Description=ICN Node
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/icn-node
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

# Enable and start the service
echo "Enabling and starting ICN node service..."
systemctl enable icn-node
systemctl start icn-node

# Print completion message
echo ""
echo "ICN Node setup complete!"
echo "Node is running as a service and will start automatically on boot."
echo "You can access the node API at http://localhost:3000"
echo ""
echo "To check the node status: systemctl status icn-node"
echo "To view logs: journalctl -u icn-node -f"
"@

# Run the setup script in WSL
Write-Host "Setting up ICN node in WSL..." -ForegroundColor Yellow
$setupScript | wsl -d $DistroName bash

# Configure port forwarding
Write-Host "Configuring port forwarding..." -ForegroundColor Yellow
$wslIp = wsl -d $DistroName -- ip addr show eth0 | Select-String -Pattern 'inet\s+([0-9.]+)' | ForEach-Object { $_.Matches.Groups[1].Value }
netsh interface portproxy add v4tov4 listenport=$NodePort connectport=$NodePort connectaddress=$wslIp
netsh interface portproxy add v4tov4 listenport=3000 connectport=3000 connectaddress=$wslIp

# Create startup script
$startupScript = @"
# ICN Node Startup Script
Write-Host "Starting ICN Node in WSL..." -ForegroundColor Cyan
wsl -d $DistroName service docker start
wsl -d $DistroName systemctl start icn-node
Write-Host "ICN Node started. API available at http://localhost:3000" -ForegroundColor Green
"@

$startupScriptPath = "$InstallDir\start-icn-node.ps1"
$startupScript | Out-File -FilePath $startupScriptPath -Encoding utf8

# Create shortcut
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Start ICN Node.lnk")
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$startupScriptPath`""
$Shortcut.Save()

# Display completion message
Write-Host ""
Write-Host "ICN Node setup complete!" -ForegroundColor Green
Write-Host "The node is now running in WSL2 as '$DistroName'." -ForegroundColor Yellow
Write-Host "You can access the node API at http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "A shortcut has been created on your desktop to start the node." -ForegroundColor Yellow
Write-Host "To start the node manually, run: wsl -d $DistroName systemctl start icn-node" -ForegroundColor Yellow
Write-Host "To view logs, run: wsl -d $DistroName journalctl -u icn-node -f" -ForegroundColor Yellow
Write-Host ""
Write-Host "Port forwarding has been configured for ports 3000 and $NodePort." -ForegroundColor Yellow 