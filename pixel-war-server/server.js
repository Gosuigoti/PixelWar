const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const { Buffer } = require('buffer');

// Configuration
const PROGRAM_ID = new PublicKey('FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL');
const CLUSTER_URL = 'https://staging-rpc.dev2.eclipsenetwork.xyz';
const connection = new Connection(CLUSTER_URL, 'confirmed');

// Initialiser le canvas (200x200 pixels, chaque pixel est un uint4, donc 0-15)
let canvas = Array(200).fill().map(() => Array(200).fill(0));

// Charger l'état initial du canvas
async function loadCanvas() {
  console.log('Chargement initial du canvas...');
  const subsectionPromises = [];

  for (let q = 0; q < 4; q++) {
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const [subsectionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('subsection'), Buffer.from([q]), Buffer.from([x]), Buffer.from([y])],
          PROGRAM_ID
        );
        subsectionPromises.push(
          connection.getAccountInfo(subsectionPda).then(accountInfo => ({
            q, x, y, accountInfo
          })).catch(err => {
            console.log(`Erreur pour (${q},${x},${y}): ${err.message}`);
            return { q, x, y, accountInfo: null };
          })
        );
      }
    }
  }

  const subsections = await Promise.all(subsectionPromises);

  for (const { q, x, y, accountInfo } of subsections) {
    if (accountInfo) {
      const data = accountInfo.data;
      const pixels = data.slice(11); // Après l'en-tête (discriminateur + quadrant/x/y)
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          const index = i * 10 + j;
          const byte = pixels[Math.floor(index / 2)];
          const color = (index % 2 === 0) ? (byte & 0x0F) : (byte >> 4);
          const globalX = q % 2 * 100 + x * 10 + i;
          const globalY = Math.floor(q / 2) * 100 + y * 10 + j;
          canvas[globalX][globalY] = color;
        }
      }
    }
  }
  console.log('Canvas chargé.');
}

// Mettre à jour le canvas à partir des logs de transactions
async function listenToTransactions() {
  connection.onProgramAccountChange(
    PROGRAM_ID,
    async (keyedAccountInfo) => {
      const accountInfo = keyedAccountInfo.accountInfo;
      const data = accountInfo.data;

      // Vérifier si c'est un compte subsection
      if (data.length === 61) { // 8 (discriminateur) + 1 (quadrant) + 1 (x) + 1 (y) + 50 (pixels)
        const quadrant = data[8];
        const x = data[9];
        const y = data[10];
        const pixels = data.slice(11);

        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < 10; j++) {
            const index = i * 10 + j;
            const byte = pixels[Math.floor(index / 2)];
            const color = (index % 2 === 0) ? (byte & 0x0F) : (byte >> 4);
            const globalX = quadrant % 2 * 100 + x * 10 + i;
            const globalY = Math.floor(quadrant / 2) * 100 + y * 10 + j;
            if (canvas[globalX][globalY] !== color) {
              canvas[globalX][globalY] = color;
              broadcastUpdate({ x: globalX, y: globalY, color });
            }
          }
        }
      }
    },
    'confirmed'
  );
}

// WebSocket Server
const wss = new WebSocket.Server({ port: 8080 });

// Diffuser les mises à jour aux clients connectés
function broadcastUpdate(update) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', data: update }));
    }
  });
}

// Envoyer l'état initial du canvas aux nouveaux clients
wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');
  ws.send(JSON.stringify({ type: 'init', data: canvas }));
});

// Démarrer le serveur
async function startServer() {
  await loadCanvas();
  listenToTransactions();
  console.log('Serveur WebSocket démarré sur ws://localhost:8080');
}

startServer();