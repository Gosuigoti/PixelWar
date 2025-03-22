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
  const { publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(null); // Initialisé à null avant réception
  const canvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  let mousePixel = useRef(null);
  let ctx = null;
  const wsRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const targetZoomRef = useRef(1); // Pour suivre le zoom cible pendant l'animation
  const scrollContainerRef = useRef(null);
  const animationRef = useRef(null); // Référence pour l'animation
  const lastScrollRef = useRef({ left: 0, top: 0 }); // Pour mémoriser la dernière position de défilement

  // Amélioration de la fonction de zoom pour une animation fluide
  const handleWheel = (e) => {
    e.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;

    // Position du curseur relative au conteneur
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Position du curseur dans le contenu défilant
    const viewportX = mouseX + container.scrollLeft;
    const viewportY = mouseY + container.scrollTop;

    // Déterminer l'intensité et la direction du zoom (plus sensible pour une expérience plus fluide)
    const zoomIntensity = 0.5;
    const delta = e.deltaY < 0 ? zoomIntensity : -zoomIntensity;

    // Annuler toute animation en cours
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    // Calcul du nouveau zoom avec des limites
    const newTargetZoom = Math.min(Math.max(zoom + delta, 1), 10);
    targetZoomRef.current = newTargetZoom;

    // Mémoriser la position de défilement actuelle
    lastScrollRef.current = {
      left: container.scrollLeft,
      top: container.scrollTop
    };

    // Point focal du zoom
    const focusPoint = {
      x: viewportX,
      y: viewportY
    };

    // Commencer l'animation de zoom
    const startZoom = zoom;
    const startTime = performance.now();
    const duration = 150; // Durée plus courte pour une réactivité accrue

    const animateZoom = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Fonction d'easing pour une animation douce
      // On utilise une fonction ease-out pour un effet de ralentissement naturel
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      // Interpolation du zoom
      const currentZoom = startZoom + (targetZoomRef.current - startZoom) * easedProgress;

      // Mettre à jour le zoom
      setZoom(currentZoom);

      // Ajuster le défilement pour maintenir le point focal
      const zoomRatio = currentZoom / startZoom;
      container.scrollLeft = focusPoint.x * zoomRatio - mouseX;
      container.scrollTop = focusPoint.y * zoomRatio - mouseY;

      // Continuer l'animation si nécessaire
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateZoom);
      } else {
        // Animation terminée, nettoyer la référence
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animateZoom);
  };

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
      // S'assurer d'annuler toute animation en cours lors du démontage
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const handleMouseMove = (e) => {
    autoScroll(e);
    if (!selectedColor || !canvasRef.current) return;
    if (!ctx) ctx = canvasRef.current.getContext('2d');

    const rect = canvasRef.current.getBoundingClientRect();
    const container = scrollContainerRef.current;

    // Position du curseur par rapport au canvas
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Taille réelle du canvas (indépendamment du zoom)
    const canvasOriginalWidth = 200;
    const canvasOriginalHeight = 200;

    // Taille affichée du canvas (après le style CSS width/height)
    const canvasDisplayWidth = 600;
    const canvasDisplayHeight = 600;

    // Ratio entre la taille affichée et la taille originale
    const displayScale = canvasDisplayWidth / canvasOriginalWidth;

    // Convertir la position de la souris en coordonnées de pixel
    // 1. Convertir la position relative au canvas affiché
    // 2. Diviser par le zoom pour obtenir la position dans l'espace non-zoomé
    // 3. Diviser par displayScale pour convertir en indices de pixel (0-199)
    const x = Math.floor(mouseX / zoom / displayScale);
    const y = Math.floor(mouseY / zoom / displayScale);

    // Restaurer le pixel précédent si la souris a bougé
    if (mousePixel.current && (mousePixel.current.x !== x || mousePixel.current.y !== y)) {
      if (mousePixel.current.x >= 0 && mousePixel.current.y >= 0 &&
          mousePixel.current.x < canvasOriginalWidth && mousePixel.current.y < canvasOriginalHeight) {
        ctx.fillStyle = COLORS[canvasData[mousePixel.current.x][mousePixel.current.y]];
        ctx.fillRect(mousePixel.current.x, mousePixel.current.y, 1, 1);
      }
    }

    // Dessiner le pixel actuel avec la couleur sélectionnée si dans les limites
    if (x >= 0 && y >= 0 && x < canvasOriginalWidth && y < canvasOriginalHeight) {
      ctx.fillStyle = COLORS[selectedColor];
      ctx.fillRect(x, y, 1, 1);
      mousePixel.current = { x, y };
    } else {
      // Réinitialiser si la souris sort des limites
      if (mousePixel.current &&
          mousePixel.current.x >= 0 && mousePixel.current.y >= 0 &&
          mousePixel.current.x < canvasOriginalWidth && mousePixel.current.y < canvasOriginalHeight) {
        const idx = canvasData[mousePixel.current.x][mousePixel.current.y];
        if (idx >= 0 && idx <= 15) {
          ctx.fillStyle = COLORS[idx];
          ctx.fillRect(mousePixel.current.x, mousePixel.current.y, 1, 1);
        }
        mousePixel.current = null;
      }
    }
  };

  // Amélioration du auto-scroll pour qu'il soit plus réactif avec le zoom
  const autoScroll = (e) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollSpeed = 10 / zoom; // Ajuster la vitesse de défilement en fonction du zoom
    const threshold = 30; // zone sensible au bord

    if (e.clientX > rect.right - threshold) {
      container.scrollLeft += scrollSpeed;
    } else if (e.clientX < rect.left + threshold) {
      container.scrollLeft -= scrollSpeed;
    }

    if (e.clientY > rect.bottom - threshold) {
      container.scrollTop += scrollSpeed;
    } else if (e.clientY < rect.top + threshold) {
      container.scrollTop -= scrollSpeed;
    }
  }

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    const handleMove = (e) => handleMouseMove(e);
    window.addEventListener('mousemove', handleMove);

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
      window.removeEventListener('mousemove', handleMove);
    };
  }, [zoom, selectedColor, canvasData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLoaded || !canvasData) return;
    if (!ctx) ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 200; y++) {
        ctx.fillStyle = COLORS[canvasData[x][y]];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [canvasData, isLoaded]);

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

  // Ajout d'une gestion pour l'interaction tactile
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      // Mode pinch-to-zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
      );
      lastPinchDistanceRef.current = distance;
    }
  };

  const lastPinchDistanceRef = useRef(0);

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      // Gestion du pinch-to-zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
      );

      const container = scrollContainerRef.current;
      if (!container) return;

      // Centre du pinch
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;

      // Position relative au conteneur
      const rect = container.getBoundingClientRect();
      const mouseX = centerX - rect.left;
      const mouseY = centerY - rect.top;

      // Position dans le contenu défilant
      const viewportX = mouseX + container.scrollLeft;
      const viewportY = mouseY + container.scrollTop;

      // Calculer le changement de zoom basé sur la différence de distance
      if (lastPinchDistanceRef.current > 0) {
        const delta = distance - lastPinchDistanceRef.current;
        const zoomDelta = delta * 0.01; // Ajuster la sensibilité

        // Calculer le nouveau zoom
        const newZoom = Math.min(Math.max(zoom + zoomDelta, 1), 10);

        // Mettre à jour le zoom
        if (newZoom !== zoom) {
          const zoomRatio = newZoom / zoom;
          setZoom(newZoom);

          // Ajuster le défilement pour maintenir le centre du pinch
          container.scrollLeft = viewportX * zoomRatio - mouseX;
          container.scrollTop = viewportY * zoomRatio - mouseY;
        }
      }

      lastPinchDistanceRef.current = distance;
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
            <div
                ref={scrollContainerRef}
                className="scroll-container"
                style={{
                  overflow: 'auto',
                  width: '600px',
                  height: '600px',
                  WebkitOverflowScrolling: 'touch', // Pour un défilement fluide sur iOS
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
            >
              <div
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    width: 'fit-content',
                    willChange: 'transform', // Optimisation pour les animations
                  }}
              >
                <canvas
                    ref={canvasRef}
                    width={200}
                    height={200}
                    className="pixel-canvas"
                    style={{
                      cursor: selectedColor === null ? 'crosshair' : 'none',
                      imageRendering: 'pixelated',
                      width: '600px',
                      height: '600px',
                    }}
                    onClick={handleCanvasClick}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}

export default App;