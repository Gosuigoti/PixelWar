const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmRawTransaction, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const fs = require('fs');

(async () => {
  try {
    const connection = new Connection('https://staging-rpc.dev2.eclipsenetwork.xyz', 'confirmed');
    const wallet = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync('C:/Users/romai/.config/solana/id.json', 'utf8')))
    );
    const programId = new PublicKey('FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL');

    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`Solde : ${balance / 1e9} SOL`);
    if (balance < 0.5e9) throw new Error("Solde insuffisant, fais un airdrop avec 'solana airdrop 2'");

    const [canvasMetaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('canvas-meta')],
      programId
    );

    // Vérifie si CanvasMeta existe déjà
    const canvasMetaAccount = await connection.getAccountInfo(canvasMetaPda);
    if (!canvasMetaAccount) {
      console.log("CanvasMeta n'est pas encore initialisé.");
    } else {
      console.log("CanvasMeta déjà initialisé.");
    }

    for (let quadrant = 0; quadrant < 4; quadrant++) {
      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
          const [subsectionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('subsection'), Buffer.from([quadrant]), Buffer.from([x]), Buffer.from([y])],
            programId
          );

          // Vérifie si la sous-section existe déjà
          const subsectionAccount = await connection.getAccountInfo(subsectionPda);
          if (subsectionAccount) {
            console.log(`Sous-section (${quadrant},${x},${y}) déjà initialisée, passage à la suivante.`);
            continue;
          }

          // Initialisation de la sous-section
          const initCanvasData = Buffer.concat([
            Buffer.from([223, 91, 237, 137, 41, 27, 240, 59]), // Discriminator de initialize_canvas
            Buffer.from([quadrant, x, y]), // quadrant, x, y
          ]);

          const initCanvasIx = new TransactionInstruction({
            keys: [
              { pubkey: canvasMetaPda, isSigner: false, isWritable: true },
              { pubkey: subsectionPda, isSigner: false, isWritable: true },
              { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data: initCanvasData,
          });

          const tx = new Transaction().add(initCanvasIx);
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = wallet.publicKey;
          tx.sign(wallet);

          const signature = await sendAndConfirmRawTransaction(connection, tx.serialize());
          console.log(`Sous-section initialisée (quadrant ${quadrant}, x ${x}, y ${y}) : ${signature}`);

          // Délai pour éviter de surcharger le réseau
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    console.log("Initialisation complète !");

  } catch (err) {
    console.error("Erreur :", err);
  }
})();