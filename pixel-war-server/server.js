const WebSocket = require('ws');
const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } = require('@solana/web3.js');
const fs = require('fs');

const PORT = 8080;
const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;
const PROGRAM_ID = new PublicKey('HAGwaTLgWF5tgjmZzWU42oq9eLXvwLmYSmKfS5Q3zCXs');
const canvasFile = '/root/pixel-war-server/canvas.json';

let canvasData = Array(GRID_WIDTH).fill().map(() => Array(GRID_HEIGHT).fill(0));
const connection = new Connection('https://staging-rpc.dev2.eclipsenetwork.xyz', 'confirmed');
const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf8')))
);

let sessionKeys = new Map(); // Map<ownerPubkey, sessionKeyPubkey>

const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`WebSocket server started on ws://localhost:${PORT}`);
});

function loadCanvasData() {
    if (fs.existsSync(canvasFile)) {
        canvasData = JSON.parse(fs.readFileSync(canvasFile, 'utf8'));
        console.log('Canvas data loaded from file');
    } else {
        canvasData = Array(GRID_WIDTH).fill().map(() => Array(GRID_HEIGHT).fill(0));
        fs.writeFileSync(canvasFile, JSON.stringify(canvasData));
        console.log('Initialized new canvas and saved to file');
    }
}

function saveCanvasData() {
    try {
        fs.writeFileSync(canvasFile, JSON.stringify(canvasData));
        console.log('Canvas data saved to file');
    } catch (error) {
        console.error('Failed to save canvas data:', error);
    }
}

async function spendCredit(ownerPubkey, sessionKeyPubkey) {
    const [pixelCreditPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pixel-credit'), new PublicKey(ownerPubkey).toBuffer()],
        PROGRAM_ID
    );

    const data = Buffer.concat([
        Buffer.from([184, 191, 206, 9, 70, 85, 25, 139]), // Discriminator pour spend_credit
        sessionKeyPubkey.toBuffer() // Argument session_key
    ]);

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: pixelCreditPda, isSigner: false, isWritable: true },
        ],
        programId: PROGRAM_ID,
        data
    });

    const tx = new Transaction().add(instruction);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);

    try {
        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature, 'confirmed');
        console.log(`Credit spent for ${ownerPubkey}: ${signature}`);
    } catch (error) {
        console.error(`Failed to spend credit for ${ownerPubkey}:`, error);
        throw error;
    }
}

loadCanvasData();

wss.on('connection', (ws, req) => {
    console.log('New client connected');
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const publicKey = urlParams.get('publicKey');
    let ownerPubkey;

    if (publicKey) {
        ownerPubkey = new PublicKey(publicKey).toBase58();
        const sessionKey = sessionKeys.get(ownerPubkey);
        if (sessionKey) {
            ws.send(JSON.stringify({ 
                type: 'init', 
                data: canvasData,
                sessionKey: sessionKey
            }));
        } else {
            // Si pas de sessionKey existante, le client doit acheter des crédits
            ws.send(JSON.stringify({ 
                type: 'init', 
                data: canvasData 
            }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'init', data: canvasData }));
    }

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else if (msg.type === 'update') {
                const { x, y, color } = msg.data;
                const clientSessionKey = msg.sessionKey;

                if (!ownerPubkey) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Wallet not connected' }));
                    return;
                }

                const storedSessionKey = sessionKeys.get(ownerPubkey);
                if (!clientSessionKey || clientSessionKey !== storedSessionKey) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or missing session key' }));
                    return;
                }

                if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
                    try {
                        await spendCredit(ownerPubkey, new PublicKey(clientSessionKey));
                        canvasData[x][y] = color;
                        saveCanvasData();
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'update', data: { x, y, color } }));
                            }
                        });
                    } catch (error) {
                        ws.send(JSON.stringify({ type: 'error', message: `Failed to update pixel: ${error.message}` }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid coordinates or color' }));
                }
            } else if (msg.type === 'sync_session') {
                const proposedSessionKey = msg.sessionKey;
                console.log('Received sync_session with key:', proposedSessionKey);

                const [pixelCreditPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from('pixel-credit'), new PublicKey(ownerPubkey).toBuffer()],
                    PROGRAM_ID
                );
                const accountInfo = await connection.getAccountInfo(pixelCreditPda);
                if (accountInfo) {
                    const storedSessionKeyBytes = accountInfo.data.slice(41, 73);
                    const storedSessionKey = new PublicKey(storedSessionKeyBytes).toBase58();
                    if (storedSessionKey === proposedSessionKey) {
                        sessionKeys.set(ownerPubkey, proposedSessionKey);
                        ws.send(JSON.stringify({ type: 'session_synced', sessionKey: proposedSessionKey }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Session key does not match on-chain' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'PixelCredit account not found' }));
                }
            }
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
    ws.on('error', (error) => console.error('WebSocket client error:', error));
});

setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'heartbeat' }));
        }
    });
}, 30000);