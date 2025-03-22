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

// Dimensions de la grille de pixels
const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;

// Facteur de base pour la limite de déplacement (sera multiplié par le niveau de zoom)
const BASE_PAN_LIMIT = 100; // Limite de base en pixels

function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(null); // Initialisé à null avant réception
  const canvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  let mousePixel = useRef(null);
  let ctx = null;
  const wsRef = useRef(null);
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 600 });

  // Nouvelle approche pour le zoom et le déplacement
  const [scale, setScale] = useState(1.0);
  const [translatePos, setTranslatePos] = useState({ x: 300, y: 300 }); // Centre du conteneur initial
  const [mouseDown, setMouseDown] = useState(false);
  const startDragOffset = useRef({ x: 0, y: 0 });

  // Observer les dimensions du conteneur
  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      const container = containerRef.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        setContainerSize({ width, height });
        // Mettre à jour le centre initial de translation
        setTranslatePos({ x: width / 2, y: height / 2 });
      }
    };

    // Exécuter immédiatement pour la taille initiale
    updateContainerSize();

    // Configuration de l'observateur de redimensionnement
    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);

  // Ajuster la taille du canvas quand containerSize change
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = containerSize.width;
      canvasRef.current.height = containerSize.height;
      drawCanvas();
    }
  }, [containerSize]);

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

    return () => {
      ws.close();
    };
  }, []);

  // Fonction pour limiter la position de translation en tenant compte du zoom
  const clampTranslatePos = (pos) => {
    // Calculer la taille effective du canvas après zoom
    const pixelSize = Math.max(1, Math.min(
        containerSize.width / GRID_WIDTH,
        containerSize.height / GRID_HEIGHT
    )) * scale;

    const effectiveCanvasWidth = GRID_WIDTH * pixelSize;
    const effectiveCanvasHeight = GRID_HEIGHT * pixelSize;

    // Calculer le centre du conteneur
    const centerX = containerSize.width / 2;
    const centerY = containerSize.height / 2;

    // Calculer les limites de déplacement adaptatives
    // Plus le zoom est grand, plus la limite est grande
    // La limite s'adapte pour ne jamais laisser le canvas complètement hors de vue
    const maxOffsetX = Math.max(effectiveCanvasWidth / 2, containerSize.width / 2 + BASE_PAN_LIMIT * scale);
    const maxOffsetY = Math.max(effectiveCanvasHeight / 2, containerSize.height / 2 + BASE_PAN_LIMIT * scale);

    return {
      x: Math.min(Math.max(pos.x, centerX - maxOffsetX), centerX + maxOffsetX),
      y: Math.min(Math.max(pos.y, centerY - maxOffsetY), centerY + maxOffsetY)
    };
  };

  // Nouvelle fonction de dessin qui applique le zoom et la translation
  const drawCanvas = () => {
    if (!canvasRef.current || !isLoaded || !canvasData) return;

    const canvas = canvasRef.current;
    if (!ctx) ctx = canvas.getContext('2d', { willReadFrequently: true });
    else ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Effacer le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Appliquer la transformation
    ctx.save();
    ctx.translate(translatePos.x, translatePos.y);
    ctx.scale(scale, scale);

    // Calculer la taille réelle des pixels pour remplir le canvas
    const pixelSize = Math.max(1, Math.min(
        canvas.width / GRID_WIDTH,
        canvas.height / GRID_HEIGHT
    ));

    // Dessiner les pixels avec décalage pour centrer le contenu
    const offsetX = -GRID_WIDTH * pixelSize / 2;
    const offsetY = -GRID_HEIGHT * pixelSize / 2;

    // Désactiver l'antialiasing pour avoir des pixels nets
    ctx.imageSmoothingEnabled = false;

    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        ctx.fillStyle = COLORS[canvasData[x][y]];

        // Utiliser des coordonnées précises et une taille exacte pour éviter les espaces
        // Ajouter une très légère marge supplémentaire (0.5) pour éviter les espaces dus à l'arrondi
        ctx.fillRect(
            offsetX + x * pixelSize,
            offsetY + y * pixelSize,
            pixelSize + 0.5,
            pixelSize + 0.5
        );
      }
    }

    ctx.restore();
  };

  // Mise à jour du canvas quand les données ou les transformations changent
  useEffect(() => {
    drawCanvas();
  }, [canvasData, isLoaded, scale, translatePos, containerSize]);

  // Gestionnaire pour le zoom avec la molette
  const handleWheel = (e) => {
    e.preventDefault();

    // Déterminer l'intensité et la direction du zoom
    const scaleMultiplier = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(scale * scaleMultiplier, 1), 20);

    // Position du curseur relative au canvas
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculer le nouveau point de translation pour zoomer vers/depuis le curseur
    const newTranslatePos = {
      x: mouseX - (mouseX - translatePos.x) * (newScale / scale),
      y: mouseY - (mouseY - translatePos.y) * (newScale / scale)
    };

    setScale(newScale);
    // Appliquer la limite de déplacement dynamique
    setTranslatePos(clampTranslatePos(newTranslatePos));
  };

  // Gestionnaires pour le déplacement du canvas
  const handleMouseDown = (e) => {
    setMouseDown(true);
    startDragOffset.current = {
      x: e.clientX - translatePos.x,
      y: e.clientY - translatePos.y
    };
  };

  const handleMouseUp = () => {
    setMouseDown(false);
  };

  const handleMouseMove = (e) => {
    if (mouseDown) {
      // Mise à jour de la position de translation lors du déplacement
      const newTranslatePos = {
        x: e.clientX - startDragOffset.current.x,
        y: e.clientY - startDragOffset.current.y
      };
      // Appliquer la limite de déplacement dynamique
      setTranslatePos(clampTranslatePos(newTranslatePos));
    }

    // Calcul de la position du pixel sous le curseur
    if (!selectedColor || !canvasRef.current || !isLoaded) return;
    if (!ctx) ctx = canvasRef.current.getContext('2d');

    const rect = containerRef.current.getBoundingClientRect();

    // Position de la souris relative au conteneur
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculer la taille réelle des pixels pour l'affichage
    const pixelSize = Math.max(1, Math.min(
        canvasRef.current.width / GRID_WIDTH,
        canvasRef.current.height / GRID_HEIGHT
    )) * scale;

    // Inverser la transformation pour obtenir les coordonnées du pixel
    const canvasX = Math.floor((mouseX - translatePos.x) / pixelSize + GRID_WIDTH / 2);
    const canvasY = Math.floor((mouseY - translatePos.y) / pixelSize + GRID_HEIGHT / 2);

    // Restaurer le pixel précédent
    if (mousePixel.current && (mousePixel.current.x !== canvasX || mousePixel.current.y !== canvasY)) {
      drawCanvas(); // Redessiner tout le canvas pour effacer l'aperçu précédent
    }

    // Prévisualiser le pixel actuel
    if (canvasX >= 0 && canvasY >= 0 && canvasX < GRID_WIDTH && canvasY < GRID_HEIGHT) {
      // Appliquer la transformation pour dessiner le pixel prévisualisé
      ctx.save();
      ctx.translate(translatePos.x, translatePos.y);
      ctx.scale(scale, scale);

      // Calculer la taille des pixels et le décalage
      const pixelSize = Math.max(1, Math.min(
          canvasRef.current.width / GRID_WIDTH,
          canvasRef.current.height / GRID_HEIGHT
      ));

      const offsetX = -GRID_WIDTH * pixelSize / 2;
      const offsetY = -GRID_HEIGHT * pixelSize / 2;

      ctx.fillStyle = COLORS[selectedColor];
      ctx.fillRect(
          offsetX + canvasX * pixelSize,
          offsetY + canvasY * pixelSize,
          pixelSize,
          pixelSize
      );

      ctx.restore();

      mousePixel.current = { x: canvasX, y: canvasY };
    } else {
      mousePixel.current = null;
    }
  };

  const handleCanvasClick = async (e) => {
    e.preventDefault();
    if (!isLoaded || !mousePixel.current) return;
    await handleDrawPixel();
  };

  const handleDrawPixel = async () => {
    const selectedPixel = mousePixel.current;
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

  // Ajout des écouteurs d'événements
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [scale, translatePos, containerSize]);

  // Gestion du pinch-to-zoom sur les appareils tactiles
  const lastPinchDistanceRef = useRef(0);
  const pinchCenterRef = useRef({ x: 0, y: 0 });

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      // Mode pinch-to-zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      // Calculer la distance initiale
      const distance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
      );
      lastPinchDistanceRef.current = distance;

      // Calculer le centre du pinch
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;

      const rect = containerRef.current.getBoundingClientRect();
      pinchCenterRef.current = {
        x: centerX - rect.left,
        y: centerY - rect.top
      };
    } else if (e.touches.length === 1) {
      // Mode déplacement
      setMouseDown(true);
      startDragOffset.current = {
        x: e.touches[0].clientX - translatePos.x,
        y: e.touches[0].clientY - translatePos.y
      };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      // Gestion du pinch-to-zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      // Calculer la nouvelle distance
      const distance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
      );

      if (lastPinchDistanceRef.current > 0) {
        // Calculer le ratio du pinch
        const scaleFactor = distance / lastPinchDistanceRef.current;
        const newScale = Math.min(Math.max(scale * scaleFactor, 1), 20);

        // Mettre à jour le zoom en conservant le centre du pinch
        const center = pinchCenterRef.current;
        const newTranslatePos = {
          x: center.x - (center.x - translatePos.x) * (newScale / scale),
          y: center.y - (center.y - translatePos.y) * (newScale / scale)
        };

        setScale(newScale);
        // Appliquer la limite de déplacement dynamique
        setTranslatePos(clampTranslatePos(newTranslatePos));
      }

      lastPinchDistanceRef.current = distance;
    } else if (e.touches.length === 1 && mouseDown) {
      // Gestion du déplacement
      const newTranslatePos = {
        x: e.touches[0].clientX - startDragOffset.current.x,
        y: e.touches[0].clientY - startDragOffset.current.y
      };
      // Appliquer la limite de déplacement dynamique
      setTranslatePos(clampTranslatePos(newTranslatePos));
    }
  };

  const handleTouchEnd = () => {
    setMouseDown(false);
    lastPinchDistanceRef.current = 0;
  };

  // Fonction pour recentrer le canvas
  const resetCanvasPosition = () => {
    setScale(1.0);
    setTranslatePos({
      x: containerSize.width / 2,
      y: containerSize.height / 2
    });
  };

  // Ajouter des indicateurs visuels pour les limites de déplacement
  const renderPanLimits = () => {
    if (!ctx || !canvasRef.current) return;

    // Calculer les limites actuelles
    const pixelSize = Math.max(1, Math.min(
        containerSize.width / GRID_WIDTH,
        containerSize.height / GRID_HEIGHT
    )) * scale;

    const effectiveCanvasWidth = GRID_WIDTH * pixelSize;
    const effectiveCanvasHeight = GRID_HEIGHT * pixelSize;

    const centerX = containerSize.width / 2;
    const centerY = containerSize.height / 2;

    const maxOffsetX = Math.max(effectiveCanvasWidth / 2, containerSize.width / 2 + BASE_PAN_LIMIT * scale);
    const maxOffsetY = Math.max(effectiveCanvasHeight / 2, containerSize.height / 2 + BASE_PAN_LIMIT * scale);

    // Dessiner les limites (optionnel, pour le débogage)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(
        centerX - maxOffsetX,
        centerY - maxOffsetY,
        maxOffsetX * 2,
        maxOffsetY * 2
    );
    ctx.stroke();
    ctx.restore();
  };

  // Interface utilisateur
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
            <div className="canvas-controls">
              <div className="zoom-controls">
                <button onClick={() => {
                  const newScale = Math.min(scale * 1.2, 20);
                  setScale(newScale);
                  // Recalculer les limites après le zoom
                  setTranslatePos(clampTranslatePos(translatePos));
                }}>+</button>
                <button onClick={() => {
                  const newScale = Math.max(scale / 1.2, 1);
                  setScale(newScale);
                  // Recalculer les limites après le zoom
                  setTranslatePos(clampTranslatePos(translatePos));
                }}>-</button>
                <button onClick={resetCanvasPosition} title="Recentrer le canvas">
                  ⟳
                </button>
              </div>
            </div>
            <div
                ref={containerRef}
                style={{
                  position: 'relative',
                  width: '600px',
                  height: '600px',
                  overflow: 'hidden',
                  touchAction: 'none', // Désactiver les gestes tactiles par défaut
                }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseOut={handleMouseUp}
                onMouseMove={handleMouseMove}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={handleCanvasClick}
            >
              <canvas
                  ref={canvasRef}
                  className="pixel-canvas"
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    cursor: selectedColor === null ? 'crosshair' : 'none',
                    imageRendering: 'pixelated',
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    transformOrigin: 'center',
                  }}
              />
            </div>
            <div className="zoom-info" style={{color: "white"}}>
              Zoom: {Math.round(scale * 100)}%
            </div>
          </div>
        </div>
      </div>
  );
}

export default App;