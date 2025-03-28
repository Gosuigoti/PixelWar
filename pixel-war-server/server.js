const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

// Configuration
const PROGRAM_ID = new PublicKey('FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL');
const CLUSTER_URL = 'https://staging-rpc.dev2.eclipsenetwork.xyz';
const connection = new Connection(CLUSTER_URL, 'confirmed');

let canvas = Array(200).fill().map(() => Array(200).fill(0));

// Fichier de log des connexions
const CONNECTION_LOG_FILE = path.join(__dirname, 'connections.log');

// Fonction pour logger une nouvelle IP si elle n'existe pas déjà
function logNewConnection(ip) {
  if (!ip) return;

  let existingIPs = [];
  if (fs.existsSync(CONNECTION_LOG_FILE)) {
    existingIPs = fs.readFileSync(CONNECTION_LOG_FILE, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
  }

  if (!existingIPs.includes(ip)) {
    fs.appendFileSync(CONNECTION_LOG_FILE, ip + '\n');
    console.log(`Nouvelle IP enregistrée : ${ip}`);
  } else {
    console.log(`Connexion existante depuis IP : ${ip}`);
  }
}

// Charger l'état initial du canvas
async function loadCanvas() {
  console.log('Chargement initial du canvas...');
  for (let q = 0; q < 4; q++) {
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const [subsectionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('subsection'), Buffer.from([q]), Buffer.from([x]), Buffer.from([y])],
            PROGRAM_ID
        );
        try {
          const accountInfo = await connection.getAccountInfo(subsectionPda);
          if (accountInfo) {
            const data = accountInfo.data;
            const pixels = data.slice(11);
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
        } catch (err) {
          console.log(`Erreur pour (${q},${x},${y}): ${err.message}`);
        }
      }
    }
  }
  console.log('Canvas chargé.');
}

// Écouter les transactions
async function listenToTransactions() {
  connection.onProgramAccountChange(
      PROGRAM_ID,
      async (keyedAccountInfo) => {
        const accountInfo = keyedAccountInfo.accountInfo;
        const data = accountInfo.data;

        if (data.length === 61) {
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

// Diffuser les mises à jour
function broadcastUpdate(update) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', data: update }));
    }
  });
}

// Gérer les connexions entrantes
wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`Nouveau client connecté depuis ${ip}`);
  logNewConnection(ip);
  ws.send(JSON.stringify({ type: 'init', data: canvas }));
});

// Démarrer
async function startServer() {
  await loadCanvas();
  listenToTransactions();
  console.log('Serveur WebSocket démarré sur ws://localhost:8080');
}

startServer();
