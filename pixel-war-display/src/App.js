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
const WS_URL = 'ws://localhost:8080';

// Palette de couleurs (0-15)
const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

// Dimensions de la grille de pixels
const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;

// Facteur de base pour la limite de déplacement
const BASE_PAN_LIMIT = 100;

// Toast component
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
      <div className={`toast toast-${type}`}>
        <div className="toast-content">
          <span>{message}</span>
        </div>
        <button className="toast-close" onClick={onClose}>&times;</button>
      </div>
  );
};

// ToastContainer component
const ToastContainer = ({ toasts, removeToast }) => {
  return (
      <div className="toast-container">
        {toasts.map((toast) => (
            <Toast
                key={toast.id}
                message={toast.message}
                type={toast.type}
                onClose={() => removeToast(toast.id)}
            />
        ))}
      </div>
  );
};

function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(null);
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  const mousePixel = useRef(null);
  const wsRef = useRef(null);
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 600 });

  const [scale, setScale] = useState(1.0);
  const [translatePos, setTranslatePos] = useState({ x: 0, y: 0 });
  const [mouseDown, setMouseDown] = useState(false);
  const startDragOffset = useRef({ x: 0, y: 0 });
  const rafId = useRef(null);

  // Toast state
  const [toasts, setToasts] = useState([]);
  const toastIdCounter = useRef(0);

  // Add toast function
  const addToast = (message, type = 'info') => {
    const id = toastIdCounter.current++;
    setToasts(prevToasts => [...prevToasts, { id, message, type }]);
  };

  // Remove toast function
  const removeToast = (id) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  };

  useEffect(() => {
    offscreenCanvasRef.current = document.createElement('canvas');
    offscreenCanvasRef.current.width = GRID_WIDTH;
    offscreenCanvasRef.current.height = GRID_HEIGHT;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      const container = containerRef.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        setContainerSize({ width, height });
        setTranslatePos({ x: 0, y: 0 });
      }
    };

    updateContainerSize();
    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = containerSize.width;
      canvasRef.current.height = containerSize.height;
      drawCanvas();
    }
  }, [containerSize]);

  useEffect(() => {
    let isActive = true; // Garde référence si cet effet est toujours actif

    const ws = new WebSocket('wss://eclipse-pixel-war.xyz/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      if (isActive) { // Vérifier si l'effet est toujours actif
        console.log('Connected to the server WebSocket');
        addToast('Connected to the server', 'success');
      }
    };

    ws.onmessage = (event) => {
      if (!isActive) return; // Ne pas traiter si l'effet n'est plus actif

      const message = JSON.parse(event.data);
      if (message.type === 'init') {
        setCanvasData(message.data);
        setLoaded(true);
        addToast('Canvas successfully loaded', 'success');
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
      if (isActive) { // Ne pas montrer de toasts si nous nettoyons l'effet
        console.log('Disconnected from the server WebSocket');
        addToast('Disconnected from the server', 'error');
      }
    };

    ws.onerror = (error) => {
      if (isActive) {
        console.error('Erreur WebSocket:', error);
        addToast('Server connection error', 'error');
      }
    };

    // Ce code s'exécute lors du démontage du composant
    return () => {
      isActive = false; // Marquer l'effet comme inactif

      // Stocker une référence à la socket avant de la fermer
      const socket = wsRef.current;

      // Si nous sommes en train de nettoyer lors du double rendu initial, ne fermons pas la socket
      if (process.env.NODE_ENV === 'development') {
        // En dev, on garde la WebSocket ouverte pour éviter le problème de double rendu
        wsRef.current = null; // Détacher la référence sans fermer
      } else {
        // En production, fermer proprement
        if (socket && socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      }
    };
  }, []); // Tableau de dépendances vide pour s'exécuter une seule fois

  const clampTranslatePos = (pos) => {
    const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
    const pixelSize = basePixelSize * scale;
    const effectiveCanvasWidth = GRID_WIDTH * pixelSize;
    const effectiveCanvasHeight = GRID_HEIGHT * pixelSize;

    const maxOffsetX = (effectiveCanvasWidth - containerSize.width) / 2 + BASE_PAN_LIMIT * scale;
    const maxOffsetY = (effectiveCanvasHeight - containerSize.height) / 2 + BASE_PAN_LIMIT * scale;

    return {
      x: Math.min(Math.max(pos.x, -maxOffsetX), maxOffsetX),
      y: Math.min(Math.max(pos.y, -maxOffsetY), maxOffsetY)
    };
  };

  const drawOffscreenCanvas = () => {
    if (!offscreenCanvasRef.current || !canvasData) return;

    const offscreenCtx = offscreenCanvasRef.current.getContext('2d');
    offscreenCtx.imageSmoothingEnabled = false;

    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        offscreenCtx.fillStyle = COLORS[canvasData[x][y]];
        offscreenCtx.fillRect(x, y, 1, 1);
      }
    }
  };

  const drawCanvas = (previewX = null, previewY = null) => {
    if (!canvasRef.current || !isLoaded || !canvasData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
    const pixelSize = basePixelSize * scale;
    const effectiveWidth = GRID_WIDTH * pixelSize;
    const effectiveHeight = GRID_HEIGHT * pixelSize;

    ctx.save();
    ctx.translate(containerSize.width / 2 + translatePos.x, containerSize.height / 2 + translatePos.y);
    ctx.drawImage(
        offscreenCanvasRef.current,
        0,
        0,
        GRID_WIDTH,
        GRID_HEIGHT,
        -effectiveWidth / 2,
        -effectiveHeight / 2,
        effectiveWidth,
        effectiveHeight
    );

    if (selectedColor !== null && previewX !== null && previewY !== null) {
      ctx.fillStyle = COLORS[selectedColor];
      // Utiliser des positions et tailles entières pour un alignement parfait
      const previewPosX = Math.floor(-effectiveWidth / 2 + previewX * pixelSize);
      const previewPosY = Math.floor(-effectiveHeight / 2 + previewY * pixelSize);
      const previewSize = Math.ceil(pixelSize); // S'assurer que la taille couvre bien le pixel
      ctx.fillRect(previewPosX, previewPosY, previewSize, previewSize);
    }

    ctx.restore();
  };

  useEffect(() => {
    drawOffscreenCanvas();
    drawCanvas();
  }, [canvasData, isLoaded]);

  useEffect(() => {
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  }, [scale, translatePos, containerSize]);

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleMultiplier = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(scale * scaleMultiplier, 1), 20);

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const mouseCanvasX = mouseX - (containerSize.width / 2 + translatePos.x);
    const mouseCanvasY = mouseY - (containerSize.height / 2 + translatePos.y);

    const newTranslatePos = {
      x: translatePos.x + mouseCanvasX * (1 - newScale / scale),
      y: translatePos.y + mouseCanvasY * (1 - newScale / scale)
    };

    setScale(newScale);
    setTranslatePos(clampTranslatePos(newTranslatePos));
  };

  const handleMouseDown = (e) => {
    setMouseDown(true);
    startDragOffset.current = {
      x: e.clientX - translatePos.x,
      y: e.clientY - translatePos.y
    };
  };

  const handleMouseUp = () => {
    setMouseDown(false);
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  };

  const handleMouseMove = (e) => {
    if (mouseDown) {
      const newTranslatePos = {
        x: e.clientX - startDragOffset.current.x,
        y: e.clientY - startDragOffset.current.y
      };
      setTranslatePos(clampTranslatePos(newTranslatePos));
      return;
    }

    if (!selectedColor || !canvasRef.current || !isLoaded) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
    const pixelSize = basePixelSize * scale;
    const effectiveWidth = GRID_WIDTH * pixelSize;
    const effectiveHeight = GRID_HEIGHT * pixelSize;

    const canvasX = Math.floor((mouseX - (containerSize.width / 2 + translatePos.x) + effectiveWidth / 2) / pixelSize);
    const canvasY = Math.floor((mouseY - (containerSize.height / 2 + translatePos.y) + effectiveHeight / 2) / pixelSize);

    if (canvasX >= 0 && canvasY >= 0 && canvasX < GRID_WIDTH && canvasY < GRID_HEIGHT) {
      if (!mousePixel.current || mousePixel.current.x !== canvasX || mousePixel.current.y !== canvasY) {
        mousePixel.current = { x: canvasX, y: canvasY };
        if (!rafId.current) {
          rafId.current = requestAnimationFrame(() => {
            drawCanvas(canvasX, canvasY);
            rafId.current = null;
          });
        }
      }
    } else if (mousePixel.current) {
      mousePixel.current = null;
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(() => {
          drawCanvas();
          rafId.current = null;
        });
      }
    }
  };

  const handleCanvasClick = async (e) => {
    e.preventDefault();
    if (!isLoaded) {
      addToast('Canvas not loaded', 'error');
      return;
    }

    if (!mousePixel.current) {
      return;
    }

    if (!publicKey) {
      addToast('Wallet not connected', 'error');
      return;
    }

    if (selectedColor === null) {
      addToast('Select a color', 'warning');
      return;
    }

    addToast('Adding the pixel...', 'info');
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
      const newCanvas = [...canvasData];
      newCanvas[selectedPixel.x][selectedPixel.y] = selectedColor;
      setCanvasData(newCanvas);
      addToast('Pixel added successfully', 'success');
    } catch (error) {
      console.warn('Transaction error :', error);
      addToast(`Error: ${error.message || 'Transaction failed'}`, 'error');
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [scale, translatePos, containerSize]);

  const lastPinchDistanceRef = useRef(0);
  const pinchCenterRef = useRef({ x: 0, y: 0 });

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
      lastPinchDistanceRef.current = distance;

      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const rect = containerRef.current.getBoundingClientRect();
      pinchCenterRef.current = { x: centerX - rect.left, y: centerY - rect.top };
    } else if (e.touches.length === 1) {
      setMouseDown(true);
      startDragOffset.current = {
        x: e.touches[0].clientX - translatePos.x,
        y: e.touches[0].clientY - translatePos.y
      };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);

      if (lastPinchDistanceRef.current > 0) {
        const scaleFactor = distance / lastPinchDistanceRef.current;
        const newScale = Math.min(Math.max(scale * scaleFactor, 1), 20);
        const center = pinchCenterRef.current;

        const mouseCanvasX = center.x - (containerSize.width / 2 + translatePos.x);
        const mouseCanvasY = center.y - (containerSize.height / 2 + translatePos.y);

        const newTranslatePos = {
          x: translatePos.x + mouseCanvasX * (1 - newScale / scale),
          y: translatePos.y + mouseCanvasY * (1 - newScale / scale)
        };

        setScale(newScale);
        setTranslatePos(clampTranslatePos(newTranslatePos));
      }
      lastPinchDistanceRef.current = distance;
    } else if (e.touches.length === 1 && mouseDown) {
      const newTranslatePos = {
        x: e.touches[0].clientX - startDragOffset.current.x,
        y: e.touches[0].clientY - startDragOffset.current.y
      };
      setTranslatePos(clampTranslatePos(newTranslatePos));
    }
  };

  const handleTouchEnd = () => {
    setMouseDown(false);
    lastPinchDistanceRef.current = 0;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  };

  const resetCanvasPosition = () => {
    setScale(1.0);
    setTranslatePos({ x: 0, y: 0 });
    addToast('Canvas reset', 'info');
  };

  const handleColorSelect = (color) => {
    setSelectedColor(color);
    addToast(`Color selected: ${COLORS[color]}`, 'info');
  };

  return (
      <div className="App">
        <h1>Pixel War Canvas</h1>
        <div className="wallet-section">
          <WalletMultiButton />
        </div>
        <div className="canvas-controls">
          <div className="zoom-info" style={{color: "white", marginBottom: "10px"}}>
            Zoom: {Math.round(scale * 100)}%
          </div>
          <div className="zoom-controls">
            <button onClick={() => {
              const newScale = Math.min(scale * 1.2, 20);
              setScale(newScale);
              setTranslatePos(clampTranslatePos(translatePos));
            }}>+</button>
            <button onClick={() => {
              const newScale = Math.max(scale / 1.2, 1);
              setScale(newScale);
              setTranslatePos(clampTranslatePos(translatePos));
            }}>-</button>
            <button onClick={resetCanvasPosition} title="Recentrer le canvas">⟳</button>
          </div>
        </div>
        <div style={{ display: !isLoaded ? "block" : "none" }}>
          <h1>Chargement...</h1>
        </div>
        <div className={isLoaded ? "" : "hidden"}>
          <div className="canvas-container">
            <div className="color-picker-container">
              <ColorPicker
                  colors={COLORS}
                  onSelect={handleColorSelect}
                  selectedColor={selectedColor}
              />
            </div>
            <div
                ref={containerRef}
                style={{
                  position: 'relative',
                  width: '600px',
                  height: '600px',
                  overflow: 'hidden',
                  touchAction: 'none',
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
          </div>
        </div>

        {/* Toast container */}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
  );
}

export default App;