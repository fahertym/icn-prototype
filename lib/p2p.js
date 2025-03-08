const Libp2p = require('libp2p');
const TCP = require('@libp2p/tcp');
const Mplex = require('@libp2p/mplex');
const { NOISE } = require('@chainsafe/libp2p-noise');
const Bootstrap = require('@libp2p/bootstrap');
const KadDHT = require('@libp2p/kad-dht');
const { multiaddr } = require('multiaddr');

class P2PNode {
  constructor(config) {
    this.config = config;
    this.node = null;
  }

  async start() {
    this.node = await Libp2p.create({
      addresses: {
        listen: this.config.listenAddresses
      },
      modules: {
        transport: [TCP],
        streamMuxer: [Mplex],
        connEncryption: [NOISE],
        peerDiscovery: [Bootstrap],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          autoDial: true,
          [Bootstrap.tag]: {
            enabled: true,
            list: this.config.bootstrapNodes
          }
        },
        dht: {
          enabled: true,
          randomWalk: {
            enabled: true
          }
        }
      }
    });

    this.node.connectionManager.on('peer:connect', (connection) => {
      console.log('Connected to', connection.remotePeer.toB58String());
    });

    await this.node.start();
    console.log('P2P node started with id', this.node.peerId.toB58String());
  }

  async stop() {
    await this.node.stop();
    console.log('P2P node stopped');
  }
}

module.exports = P2PNode; 