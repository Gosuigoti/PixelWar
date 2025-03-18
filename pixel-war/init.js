const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmRawTransaction, SystemProgram, TransactionInstruction } = require("@solana/web3.js");
const fs = require("fs");

(async () => {
    try {
        const connection = new Connection("https://staging-rpc.dev2.eclipsenetwork.xyz", "confirmed");
        const keypair = Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(fs.readFileSync("C:/Users/romai/.config/solana/id.json", "utf8")))
        );
        const programId = new PublicKey("FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL");

        const [subsectionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subsection"), Buffer.from([0]), Buffer.from([0]), Buffer.from([0])], // quadrant 0, x 0, y 0
            programId
        );

        const [canvasMetaPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("canvas-meta")],
            programId
        );

        const balance = await connection.getBalance(keypair.publicKey);
        console.log(`Solde : ${balance / 1e9} SOL`);
        if (balance < 1e9) throw new Error("Solde insuffisant, fais un airdrop avec 'solana airdrop 2'");

        // Étape 1 : Initialiser CanvasMeta et la sous-section (0,0,0) si pas déjà fait
        const subsectionAccount = await connection.getAccountInfo(subsectionPda);
        if (!subsectionAccount) {
            const initCanvasData = Buffer.concat([
                Buffer.from([223, 91, 237, 137, 41, 27, 240, 59]), // Discriminator de initialize_canvas
                Buffer.from([0, 0, 0]), // quadrant, x, y
            ]);

            const initCanvasIx = new TransactionInstruction({
                keys: [
                    { pubkey: canvasMetaPda, isSigner: false, isWritable: true },
                    { pubkey: subsectionPda, isSigner: false, isWritable: true },
                    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId,
                data: initCanvasData,
            });

            const initCanvasTx = new Transaction().add(initCanvasIx);
            const { blockhash } = await connection.getLatestBlockhash();
            initCanvasTx.recentBlockhash = blockhash;
            initCanvasTx.feePayer = keypair.publicKey;
            initCanvasTx.sign(keypair);
            const initCanvasSignature = await sendAndConfirmRawTransaction(connection, initCanvasTx.serialize());
            console.log(`Canvas et sous-section (0,0,0) initialisés : ${initCanvasSignature}`);
        } else {
            console.log("Sous-section (0,0,0) déjà initialisée, passage à draw_pixels_direct");
        }

        // Étape 2 : Dessiner un motif de pixels bleus avec draw_pixels_direct
        const pixels = [
            // Bloc 3x3 de bleu (couleur 3) en haut à gauche
            { x: 0, y: 0, color: 3 },
            { x: 0, y: 1, color: 3 },
            { x: 0, y: 2, color: 3 },
            { x: 1, y: 0, color: 3 },
            { x: 1, y: 1, color: 3 },
            { x: 1, y: 2, color: 3 },
            { x: 2, y: 0, color: 3 },
            { x: 2, y: 1, color: 3 },
            { x: 2, y: 2, color: 3 },
            // Quelques pixels bleus dispersés
            { x: 5, y: 5, color: 3 },
            { x: 7, y: 7, color: 3 },
            { x: 9, y: 9, color: 3 },
        ];

        const data = Buffer.alloc(8 + 4 + pixels.length * 3);
        Buffer.from([180, 185, 58, 15, 109, 2, 112, 85]).copy(data, 0); // Discriminator de draw_pixels_direct
        data.writeUInt32LE(pixels.length, 8);
        pixels.forEach((p, i) => {
            const offset = 12 + i * 3;
            data.writeUInt8(p.x, offset);
            data.writeUInt8(p.y, offset + 1);
            data.writeUInt8(p.color, offset + 2);
        });

        const drawPixelsIx = new TransactionInstruction({
            keys: [
                { pubkey: subsectionPda, isSigner: false, isWritable: true },
                { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const drawPixelsTx = new Transaction().add(drawPixelsIx);
        const { blockhash } = await connection.getLatestBlockhash();
        drawPixelsTx.recentBlockhash = blockhash;
        drawPixelsTx.feePayer = keypair.publicKey;
        drawPixelsTx.sign(keypair);
        const drawPixelsSignature = await sendAndConfirmRawTransaction(connection, drawPixelsTx.serialize());
        console.log(`Pixels bleus dessinés avec draw_pixels_direct : ${drawPixelsSignature}`);

    } catch (err) {
        console.error("Erreur :", err);
    }
})();

class BigInt64LE {
    constructor(value) {
        this.value = BigInt(value);
    }
    toBuffer() {
        const buffer = Buffer.alloc(8);
        buffer.writeBigInt64LE(this.value);
        return buffer;
    }
}