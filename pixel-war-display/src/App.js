import React, { useEffect, useState, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import ColorPicker from './ColorPicker';
import './App.css';

// Configuration de base
const PROGRAM_ID = new PublicKey('FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL');
const CLUSTER_URL = 'https://staging-rpc.dev2.eclipsenetwork.xyz';
const WS_URL = 'ws://localhost:8080'; // URL du serveur WebSocket

// Palette de couleurs (0-15)
const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

function App() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(null); // Initialisé à null avant réception
  const canvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  let mousePixel = null;
  let ctx = null;
  const wsRef = useRef(null);

  // Connexion au WebSocket et gestion des messages
  useEffect(() => {
    const ws = new WebSocket('wss://eclipse-pixel-war.xyz/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connecté au serveur WebSocket');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'init') {
        setCanvasData(message.data);
        setLoaded(true);
      } else if (message.type === 'update') {
        const { x, y, color } = message.data;
        setCanvasData(prev => {
          const newCanvas = [...prev];
          newCanvas[x][y] = color;
          return newCanvas;
        });
      }
    };

    ws.onclose = () => {
      console.log('Déconnecté du serveur WebSocket');
    };

    return () => ws.close();
  }, []);

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
      mousePixel = { x: x, y: y };
    } else {
      if (mousePixel && 
          mousePixel.x >= 0 && 
          mousePixel.y >= 0 && 
          mousePixel.x <= 199 && 
          mousePixel.y <= 199) {
        const idx = canvasData[mousePixel.x][mousePixel.y];
        if (idx >= 0 && idx <= 15) {
          ctx.fillStyle = COLORS[idx];
          ctx.fillRect(mousePixel.x, mousePixel.y, 1, 1);
        }
      }
    }
  };

  useEffect(() => {
    const handleMove = (e) => handleMouseMove(e);
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [selectedColor, canvasData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLoaded || !canvasData) return;
    if (!ctx) ctx = canvas.getContext('2d');
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 200; y++) {
        ctx.fillStyle = COLORS[canvasData[x][y]];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [canvasData, isLoaded]);

  const handleCanvasClick = async () => {
    if (!isLoaded || !mousePixel) return;
    await handleDrawPixel();
  };

  const handleDrawPixel = async () => {
    const selectedPixel = mousePixel;
    if (!selectedPixel || !publicKey) return;

    const quadrant = Math.floor(selectedPixel.x / 100) + Math.floor(selectedPixel.y / 100) * 2;
    const subX = Math.floor((selectedPixel.x % 100) / 10);
    const subY = Math.floor((selectedPixel.y % 100) / 10);
    const pixelX = selectedPixel.x % 10;
    const pixelY = selectedPixel.y % 10;

    const [subsectionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('subsection'), Buffer.from([quadrant]), Buffer.from([subX]), Buffer.from([subY])],
      PROGRAM_ID
    );

    const recipientPubkey = new PublicKey('EiogKSRa3tQJXyFrQqecc5z8DHNwjAn8pdR61yTKdLaP');

    const pixel = { x: pixelX, y: pixelY, color: selectedColor };

    const data = Buffer.alloc(8 + 4 + 3);
    Buffer.from([180, 185, 58, 15, 109, 2, 112, 85]).copy(data, 0);
    data.writeUInt32LE(1, 8);
    data.writeUInt8(pixel.x, 12);
    data.writeUInt8(pixel.y, 13);
    data.writeUInt8(pixel.color, 14);

    const drawPixelsIx = new TransactionInstruction({
      keys: [
        { pubkey: subsectionPda, isSigner: false, isWritable: true },
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: data,
    });

    const transaction = new Transaction().add(drawPixelsIx);

    try {
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      // Mise à jour locale immédiate (optionnel, le serveur la diffusera aussi)
      const newCanvas = [...canvasData];
      newCanvas[selectedPixel.x][selectedPixel.y] = selectedColor;
      setCanvasData(newCanvas);
    } catch (error) {
      console.warn('Erreur lors de la transaction :', error);
    }
  };

  return (
    <div className="App">
      <h1>Pixel War Canvas</h1>
      <div className="wallet-section">
        <WalletMultiButton />
      </div>
      <div style={{ display: !isLoaded ? "block" : "none" }}>
        <h1>Chargement...</h1>
      </div>
      <div className={isLoaded ? "" : "hidden"}>
        <div className="canvas-container">
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
            className="pixel-canvas"
            style={{ width: '600px', height: '600px', imageRendering: 'pixelated' }}
            onClick={handleCanvasClick}
          />
        </div>
      </div>
    </div>
  );
}

export default App;