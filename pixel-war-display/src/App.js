import React, { useEffect, useState, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import ColorPicker from './ColorPicker';
import './App.css';

// Configuration de base
const PROGRAM_ID = new PublicKey('FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL');
const CLUSTER_URL = 'https://staging-rpc.dev2.eclipsenetwork.xyz';

// Palette de couleurs (0-15)
const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

function App() {
  const { connection } = useConnection();
  const { connected, signMessage, publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(Array(200).fill().map(() => Array(200).fill(0)));
  const canvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  let mousePixel = null;
  let ctx = null;

  // Charger les données du canvas au démarrage
  const loadCanvas = async () => {
    const newCanvas = Array(200).fill().map(() => Array(200).fill(0));

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
              const pixels = data.slice(11); // Skip quadrant, x, y (3 bytes)
              for (let i = 0; i < 10; i++) {
                for (let j = 0; j < 10; j++) {
                  const index = i * 10 + j;
                  const byte = pixels[Math.floor(index / 2) + 3]; // Adjust offset
                  const color = (index % 2 === 0) ? (byte & 0x0F) : (byte >> 4);
                  const globalX = q % 2 * 100 + x * 10 + i;
                  const globalY = Math.floor(q / 2) * 100 + y * 10 + j;
                  newCanvas[globalX][globalY] = color;
                }
              }
            } else {
              console.log(`Subsection (${q},${x},${y}) not found or uninitialized at ${subsectionPda.toBase58()}`);
            }
          } catch (err) {
            console.log(`Error loading subsection (${q},${x},${y}): ${err.message}`);
          }
        }
      }
    }
    setLoaded(true);
    setCanvasData(newCanvas);
  };

  const handleMouseMove = (e) => {
    if (!selectedColor || !canvasRef.current) return;
    if (!ctx) ctx = canvasRef.current.getContext('2d');

    const rect = canvasRef.current.getBoundingClientRect();
    const scaling_factor_x = rect.width / canvasRef.current.width;
    const scaling_factor_y = rect.height / canvasRef.current.height;
    const x = Math.floor((e.clientX - rect.left) / scaling_factor_x);
    const y = Math.floor((e.clientY - rect.top) / scaling_factor_y);

    if (mousePixel && (mousePixel.x !== x || mousePixel.y !== y)) {
      if (mousePixel.x >= 0 && mousePixel.y >= 0 && mousePixel.x <= 199 && mousePixel.y <= 199) {
        ctx.fillStyle = COLORS[canvasData[mousePixel.x][mousePixel.y]];
        ctx.fillRect(mousePixel.x, mousePixel.y, 1, 1);
      }
    }

    if (x >= 0 && y >= 0 && x <= 199 && y <= 199) {
      ctx.fillStyle = COLORS[selectedColor];
      ctx.fillRect(x, y, 1, 1);
      mousePixel = {x: x, y: y};
    } else {
      if (mousePixel
          && mousePixel.x >= 0
          && mousePixel.y >= 0
          && mousePixel.x <= 199
          && mousePixel.y <= 199 ) {
        let idx = canvasData[mousePixel.x][mousePixel.y]
        if (idx < 15 && idx >= 0) {
        ctx.fillStyle = COLORS[canvasData[mousePixel.x][mousePixel.y]];
        ctx.fillRect(mousePixel.x, mousePixel.y, 1, 1);
        }
      }
    }
  };

  window.addEventListener('mousemove', (e) => {
    handleMouseMove(e);
  })



  useEffect(() => {
    loadCanvas();
  }, [connection]);

  // Dessiner le canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (ctx === null) {
      ctx = canvas.getContext('2d');
    }
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 200; y++) {
        ctx.fillStyle = COLORS[canvasData[x][y]];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [canvasData]);

  const handleCanvasClick = (event) => {
    //if (!isLoaded) return;
    handleDrawPixel().finally();
  };

  // Envoyer la transaction pour modifier le pixel
  const handleDrawPixel = async () => {
    const selectedPixel = mousePixel;
    if (!mousePixel) return;

    const quadrant = Math.floor(selectedPixel.x / 100) + Math.floor(selectedPixel.y / 100) * 2;
    const subX = Math.floor((selectedPixel.x % 100) / 10);
    const subY = Math.floor((selectedPixel.y % 100) / 10);
    const pixelX = selectedPixel.x % 10;
    const pixelY = selectedPixel.y % 10;

    const [subsectionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('subsection'), Buffer.from([quadrant]), Buffer.from([subX]), Buffer.from([subY])],
      PROGRAM_ID
    );

    const pixel = { x: pixelX, y: pixelY, color: selectedColor };

    // Construire les données comme dans init.js
    const data = Buffer.alloc(8 + 4 + 3); // Discriminator (8) + Nombre de pixels (4) + Pixel data (3)
    Buffer.from([180, 185, 58, 15, 109, 2, 112, 85]).copy(data, 0); // Discriminator de draw_pixels_direct
    data.writeUInt32LE(1, 8); // Nombre de pixels (1)
    data.writeUInt8(pixel.x, 12); // x
    data.writeUInt8(pixel.y, 13); // y
    data.writeUInt8(pixel.color, 14); // color

    // Créer l'instruction manuellement
    const drawPixelsIx = new TransactionInstruction({
      keys: [
        { pubkey: subsectionPda, isSigner: false, isWritable: true }, // Subsection
        { pubkey: publicKey, isSigner: true, isWritable: false }, // Authority
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
      ],
      programId: PROGRAM_ID,
      data: data,
    });

    const transaction = new Transaction().add(drawPixelsIx);

    try {
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      // Mettre à jour localement le canvas
      const newCanvas = [...canvasData];
      newCanvas[selectedPixel.x][selectedPixel.y] = selectedColor;
      setCanvasData(newCanvas);
    } catch (error) {
      console.error('Erreur lors de la transaction :', error);
    }
  };

  return (
            <div className={"App"}>
              <h1>Pixel War Canvas</h1>
              <div className="wallet-section">
                <WalletMultiButton/>
              </div>
              <div style={{display: !isLoaded ? "block" : "none"}}>
                <h1>Loading....</h1>
              </div>
              <div className={isLoaded ? "" : "hidden"}>
                <div className={"canvas-container"}>
                  <div className="color-picker-container">
                          <ColorPicker
                              colors={COLORS}
                              onSelect={(color) => setSelectedColor(color)}
                              selectedColor={selectedColor}
                          />
                    </div>
                  <canvas
                      ref={canvasRef}
                      width={200}
                      height={200}
                      className={"pixel-canvas"}
                      style={{width: '600px', height: '600px', imageRendering: 'pixelated'}}
                      onClick={handleCanvasClick}
                  />
                </div>
              </div>
            </div>
  );
}

export default App;