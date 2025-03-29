const WebSocket = require('ws');
const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');

// Configuration
const PORT = 8080;
const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;
const PROGRAM_ID = new PublicKey('HAGwaTLgWF5tgjmZzWU42oq9eLXvwLmYSmKfS5Q3zCXs');

// Initialisation du canvas (200x200, rempli de 0 par défaut)
let canvasData = Array(GRID_WIDTH).fill().map(() => Array(GRID_HEIGHT).fill(0));

// Fichier pour sauvegarder le canvas
const canvasFile = '/root/pixel-war-server/canvas.json';

// Connexion à la blockchain Eclipse
const connection = new Connection('https://staging-rpc.dev2.eclipsenetwork.xyz', 'confirmed');
const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf8')))
);

// Charger ou générer la sessionKey, synchronisée avec la blockchain
let sessionKey;
const sessionKeyFile = '/root/pixel-war-server/session-key.json';
async function initializeSessionKey() {
    const [pixelCreditPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pixel-credit'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(pixelCreditPda);
    
    if (accountInfo) {
        const sessionKeyBytes = accountInfo.data.slice(41, 73);
        const storedSessionKey = new PublicKey(sessionKeyBytes);
        console.log('Session key from chain:', storedSessionKey.toBase58());

        // Charger depuis le fichier uniquement pour la clé privée, mais utiliser la clé publique on-chain
        if (fs.existsSync(sessionKeyFile)) {
            sessionKey = Keypair.fromSecretKey(
                new Uint8Array(JSON.parse(fs.readFileSync(sessionKeyFile, 'utf8')))
            );
            console.log('Loaded sessionKey from file:', sessionKey.publicKey.toBase58());
        } else {
            sessionKey = Keypair.generate();
            fs.writeFileSync(sessionKeyFile, JSON.stringify(Array.from(sessionKey.secretKey)));
            console.log('Generated new sessionKey:', sessionKey.publicKey.toBase58());
        }

        // Forcer la clé publique à correspondre à celle on-chain
        sessionKey.publicKey = storedSessionKey;
        console.log('SessionKey synchronized with on-chain:', sessionKey.publicKey.toBase58());
    } else {
        console.log('PixelCredit account not found, generating new sessionKey...');
        sessionKey = Keypair.generate();
        fs.writeFileSync(sessionKeyFile, JSON.stringify(Array.from(sessionKey.secretKey)));
        console.log('Generated new sessionKey:', sessionKey.publicKey.toBase58());
    }
}

// Initialisation du serveur WebSocket
const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`WebSocket server started on ws://localhost:${PORT}`);
});

// Acheter des crédits pour dessiner
async function buyPixelCredits(amount) {
    const [pixelCreditPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pixel-credit'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
    );

    const buyCreditsData = Buffer.alloc(41);
    Buffer.from([236, 132, 140, 248, 22, 186, 122, 234]).copy(buyCreditsData, 0); // Discriminator
    buyCreditsData.writeUInt8(amount, 8); // Amount (u8)
    sessionKey.publicKey.toBuffer().copy(buyCreditsData, 9); // Session key (pubkey)

    const buyCreditsIx = new TransactionInstruction({
        keys: [
            { pubkey: pixelCreditPda, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: true }, // Recipient
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: buyCreditsData
    });

    const tx = new Transaction().add(buyCreditsIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);

    try {
        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature);
        console.log(`Bought ${amount} pixel credits: ${signature}`);
    } catch (error) {
        console.error(`Failed to buy pixel credits: ${error}`);
        throw error;
    }
}

// Charger le canvas depuis un fichier local
function loadCanvasData() {
    console.log('Loading canvas data from local file...');
    if (fs.existsSync(canvasFile)) {
        const data = fs.readFileSync(canvasFile, 'utf8');
        canvasData = JSON.parse(data);
        console.log('Canvas data loaded from file');
    } else {
        canvasData = Array(GRID_WIDTH).fill().map(() => Array(GRID_HEIGHT).fill(0));
        fs.writeFileSync(canvasFile, JSON.stringify(canvasData));
        console.log('Initialized new canvas and saved to file');
    }
    console.log('Sample of canvasData:');
    console.log('Top-left corner (0,0):', canvasData[0][0]);
    console.log('Middle (100,100):', canvasData[100][100]);
    console.log('Bottom-right corner (199,199):', canvasData[199][199]);
    console.log('Non-zero pixels count:', canvasData.flat().filter(val => val !== 0).length);
}

// Sauvegarder le canvas dans un fichier local
function saveCanvasData() {
    try {
        fs.writeFileSync(canvasFile, JSON.stringify(canvasData));
        console.log('Canvas data saved to file');
    } catch (error) {
        console.error('Failed to save canvas data:', error);
    }
}

// Dessiner des pixels (mise à jour locale uniquement)
async function drawPixels(pixels) {
    const [pixelCreditPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pixel-credit'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(pixelCreditPda);
    if (!accountInfo) {
        throw new Error('PixelCredit account not found');
    }

    const remainingEdits = accountInfo.data.readUInt8(40);
    if (remainingEdits < pixels.length) {
        throw new Error('Not enough credits to draw pixels');
    }

    const storedSessionKeyBytes = accountInfo.data.slice(41, 73);
    const storedSessionKey = new PublicKey(storedSessionKeyBytes);
    if (!storedSessionKey.equals(sessionKey.publicKey)) {
        throw new Error('Invalid session key');
    }

    pixels.forEach(pixel => {
        const { x, y, color } = pixel;
        if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
            canvasData[x][y] = color;
        }
    });

    saveCanvasData();

    const newRemainingEdits = remainingEdits - pixels.length;
    const updateCreditsData = Buffer.alloc(9);
    Buffer.from([156, 171, 64, 152, 68, 214, 8, 51]).copy(updateCreditsData, 0); // Discriminator pour update_pixel_credits
    updateCreditsData.writeUInt8(newRemainingEdits, 8);

    const updateCreditsIx = new TransactionInstruction({
        keys: [
            { pubkey: pixelCreditPda, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: updateCreditsData
    });

    const tx = new Transaction().add(updateCreditsIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);

    try {
        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(signature);
        console.log(`Credits updated on chain: ${signature}`);
    } catch (error) {
        console.error(`Failed to update credits on chain: ${error}`);
        throw error;
    }
}

// Charger les données et initialiser au démarrage
loadCanvasData();
(async () => {
    // Initialiser la sessionKey avec la blockchain
    await initializeSessionKey();

    try {
        console.log('Attempting to buy 10 credits to synchronize sessionKey...');
        await buyPixelCredits(10);
        console.log('Successfully bought 10 credits and synchronized sessionKey');
    } catch (error) {
        console.error('Failed to buy initial pixel credits:', error);
        process.exit(1);
    }

    // Gestion des connexions WebSocket
    wss.on('connection', (ws) => {
        console.log('New client connected');
        console.log('Sending canvasData, size:', canvasData.length, canvasData[0].length);
        ws.send(JSON.stringify({ 
            type: 'init', 
            data: canvasData,
            sessionKey: sessionKey.publicKey.toBase58()
        }));

        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message);
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                } else if (msg.type === 'update') {
                    const { x, y, color } = msg.data;
                    const clientSessionKey = msg.sessionKey;

                    // Vérifier la sessionKey
                    if (!clientSessionKey || clientSessionKey !== sessionKey.publicKey.toBase58()) {
                        console.error('Invalid session key received:', clientSessionKey);
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid session key' }));
                        return;
                    }

                    if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && color >= 0 && color < 16) {
                        try {
                            await drawPixels([{ x, y, color }]);
                        } catch (error) {
                            console.error('Failed to persist pixel update:', error);
                            ws.send(JSON.stringify({ type: 'error', message: error.message || 'Failed to update pixel' }));
                            return;
                        }

                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'update', data: { x, y, color } }));
                            }
                        });
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid coordinates or color' }));
                    }
                } else if (msg.type === 'sync_session') {
                    const proposedSessionKey = msg.sessionKey;
                    console.log('Received sync_session with key:', proposedSessionKey);

                    try {
                        const newSessionKeyPub = new PublicKey(proposedSessionKey);
                        const [pixelCreditPda] = PublicKey.findProgramAddressSync(
                            [Buffer.from('pixel-credit'), wallet.publicKey.toBuffer()],
                            PROGRAM_ID
                        );
                        const accountInfo = await connection.getAccountInfo(pixelCreditPda);
                        if (accountInfo) {
                            const storedSessionKeyBytes = accountInfo.data.slice(41, 73);
                            const storedSessionKey = new PublicKey(storedSessionKeyBytes);
                            if (storedSessionKey.toBase58() === newSessionKeyPub.toBase58()) {
                                sessionKey.publicKey = newSessionKeyPub;
                                console.log('Session key updated to match on-chain:', sessionKey.publicKey.toBase58());
                                ws.send(JSON.stringify({ type: 'session_synced', sessionKey: sessionKey.publicKey.toBase58() }));
                            } else {
                                console.error('Proposed session key does not match on-chain key:', storedSessionKey.toBase58());
                                ws.send(JSON.stringify({ type: 'error', message: 'Session key does not match on-chain' }));
                            }
                        } else {
                            console.error('PixelCredit account not found for validation');
                            ws.send(JSON.stringify({ type: 'error', message: 'PixelCredit account not found' }));
                        }
                    } catch (error) {
                        console.error('Invalid session key proposed:', error);
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid session key format' }));
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

    wss.on('error', (error) => {
        console.error(`WebSocket server error: ${error.message}`);
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Try a different port.`);
        }
    });

    // Heartbeat toutes les 30 secondes
    setInterval(() => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'heartbeat' }));
            }
        });
    }, 30000);
})().catch(error => {
    console.error('Failed to initialize server:', error);
    process.exit(1);
});