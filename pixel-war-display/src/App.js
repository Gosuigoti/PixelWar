import React, { useEffect, useState, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SendTransactionError
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import ColorPicker from './ColorPicker';
import './App.css';
import { Routes, Route, Link } from 'react-router-dom';
import FreeVersionCanvas from './FreeVersionCanvas';

const PROGRAM_ID = new PublicKey('tUEdVaX96HLDaa1Mbn4r3ct9rKbXE8ey8k145HEV64Z');
const TREASURY_PUBLIC_KEY = new PublicKey('8C7f9hiEnCogp1U4JNmmZiVe5exdNfdUqZEYq8wT8uWk');
const CLUSTER_URL = 'https://eclipse.helius-rpc.com';
const WS_URL = 'wss://www.eclipse-pixel-war.xyz/ws';

const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

const GRID_WIDTH = 800;
const GRID_HEIGHT = 800;
const LAMPORTS_PER_CREDIT = 146;
const WEI_PER_ETH = LAMPORTS_PER_SOL;
const TX_FEE_ECLIPSE = 1582;
const TREASURY_FEE = 56;

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <span>{message}</span>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
};

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="toast-container">
    {toasts.map(toast => (
      <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
    ))}
  </div>
);

const BuyCreditsModal = ({ onClose, onBuyCredits, connection }) => {
  const [rentExemptLamports, setRentExemptLamports] = useState(0);

  useEffect(() => {
    const fetchRent = async () => {
      const rent = await connection.getMinimumBalanceForRentExemption(0);
      setRentExemptLamports(rent);
    };
    fetchRent();
  }, [connection]);

  const cost250Credits = (250 * LAMPORTS_PER_CREDIT + TX_FEE_ECLIPSE + rentExemptLamports + 624000) / WEI_PER_ETH;

  return (
    <div className="modal-overlay">
      <div className="modal-content buy-credits-modal">
        <button className="modal-close" onClick={onClose}>×</button>
        <p>You don’t have enough credits to add a pixel. Please buy more credits to continue.</p>
        <div className="modal-buttons">
          <div className="modal-button-wrapper">
            <button className="modal-btn" onClick={() => onBuyCredits(250)}>250 Credits</button>
            <div className="modal-cost">{cost250Credits.toFixed(6)} ETH</div>
          </div>
        </div>
      </div>
    </div>
  );
};

function MainApp() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [canvasData, setCanvasData] = useState(null);
  const [sessionKey, setSessionKey] = useState(null);
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedColorValue, setSelectedColorValue] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  const mousePixel = useRef(null);
  const wsRef = useRef(null);
  const containerRef = useRef(null);
  const colorPickerContainerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 600 });
  const [colorPickerWidth, setColorPickerWidth] = useState(600);
  const [scale, setScale] = useState(1.0);
  const [translatePos, setTranslatePos] = useState({ x: 0, y: 0 });
  const [mouseDown, setMouseDown] = useState(false);
  const startDragOffset = useRef({ x: 0, y: 0 });
  const rafId = useRef(null);
  const [toasts, setToasts] = useState([]);
  const toastIdCounter = useRef(0);
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [pendingPixel, setPendingPixel] = useState(null);

  const addToast = (message, type = 'info') => {
    const id = toastIdCounter.current++;
    setToasts(prev => {
      if (prev.length >= 2) {
        return [...prev.slice(1), { id, message, type }];
      }
      return [...prev, { id, message, type }];
    });
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  useEffect(() => {
    offscreenCanvasRef.current = document.createElement('canvas');
    offscreenCanvasRef.current.width = GRID_WIDTH;
    offscreenCanvasRef.current.height = GRID_HEIGHT;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const minDimension = Math.min(width, height);
      setContainerSize({ width: minDimension, height: minDimension });
      setColorPickerWidth(minDimension);
      setTranslatePos(clampTranslatePos(translatePos, scale));
    };

    const debouncedUpdateContainerSize = debounce(updateContainerSize, 100);

    updateContainerSize();
    const resizeObserver = new ResizeObserver(debouncedUpdateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (colorPickerContainerRef.current) {
      colorPickerContainerRef.current.style.width = `${colorPickerWidth}px`;
    }
  }, [colorPickerWidth]);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = containerSize.width;
      canvasRef.current.height = containerSize.height;
      drawCanvas();
    }
  }, [containerSize]);

  useEffect(() => {
    let isActive = true;

    const url = publicKey ? `${WS_URL}?publicKey=${publicKey.toBase58()}` : WS_URL;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isActive) {
        console.log('Connected to WebSocket');
        addToast('Connected to server', 'success');
      }
    };

    ws.onmessage = (event) => {
      if (!isActive) return;
      const message = JSON.parse(event.data);
      if (message.type === 'init') {
        setCanvasData(message.data);
        setLoaded(true);
        if (message.sessionKey) {
          setSessionKey(message.sessionKey);
        }
      } else if (message.type === 'update') {
        const { x, y, color } = message.data;
        setCanvasData(prev => {
          const newCanvas = [...prev];
          newCanvas[x][y] = color;
          return newCanvas;
        });
        if (pendingPixel && pendingPixel.x === x && pendingPixel.y === y) {
          setPendingPixel(null);
        }
      } else if (message.type === 'error') {
        console.error('Error from server:', message.message);
        addToast(`Error: ${message.message}`, 'error');
      } else if (message.type === 'pong' || message.type === 'heartbeat') {
        // Nothing to do
      } else if (message.type === 'session_synced') {
        console.log('Session key synced with server:', message.sessionKey);
        setSessionKey(message.sessionKey);
      }
    };

    ws.onclose = () => {
      if (isActive) addToast('Disconnected from server', 'error');
    };

    ws.onerror = () => {
      if (isActive) addToast('WebSocket error', 'error');
    };

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      isActive = false;
      clearInterval(heartbeat);
      ws.close();
    };
  }, [publicKey]);

  const clampTranslatePos = (pos, currentScale) => {
    const pixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT) * currentScale;
    const effectiveCanvasWidth = GRID_WIDTH * pixelSize;
    const effectiveCanvasHeight = GRID_HEIGHT * pixelSize;

    const maxOffsetX = Math.max(0, (effectiveCanvasWidth - containerSize.width) / 2);
    const maxOffsetY = Math.max(0, (effectiveCanvasHeight - containerSize.height) / 2);

    return {
      x: Math.min(Math.max(pos.x, -maxOffsetX), maxOffsetX),
      y: Math.min(Math.max(pos.y, -maxOffsetY), maxOffsetY)
    };
  };

  const adjustTranslatePosOnZoom = (newScale, oldScale) => {
    const pixelSizeOld = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT) * oldScale;
    const pixelSizeNew = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT) * newScale;

    const effectiveWidthOld = GRID_WIDTH * pixelSizeOld;
    const effectiveHeightOld = GRID_HEIGHT * pixelSizeOld;
    const effectiveWidthNew = GRID_WIDTH * pixelSizeNew;
    const effectiveHeightNew = GRID_HEIGHT * pixelSizeNew;

    const offsetXOld = containerSize.width / 2 + translatePos.x - effectiveWidthOld / 2;
    const offsetYOld = containerSize.height / 2 + translatePos.y - effectiveHeightOld / 2;

    const relativeX = (containerSize.width / 2 - offsetXOld) / effectiveWidthOld;
    const relativeY = (containerSize.height / 2 - offsetYOld) / effectiveHeightOld;

    const newOffsetX = containerSize.width / 2 - relativeX * effectiveWidthNew;
    const newOffsetY = containerSize.height / 2 - relativeY * effectiveHeightNew;

    const newTranslatePos = {
      x: newOffsetX - (containerSize.width / 2 - effectiveWidthNew / 2),
      y: newOffsetY - (containerSize.height / 2 - effectiveHeightNew / 2)
    };

    return clampTranslatePos(newTranslatePos, newScale);
  };

  const drawOffscreenCanvas = () => {
    if (!offscreenCanvasRef.current || !canvasData) return;
    const offscreenCtx = offscreenCanvasRef.current.getContext('2d');
    offscreenCtx.imageSmoothingEnabled = false;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        offscreenCtx.fillStyle = canvasData[y][x] || '#FFFFFF';
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

    const offsetX = containerSize.width / 2 + translatePos.x - effectiveWidth / 2;
    const offsetY = containerSize.height / 2 + translatePos.y - effectiveHeight / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
      offscreenCanvasRef.current,
      0,
      0,
      GRID_WIDTH,
      GRID_HEIGHT,
      offsetX,
      offsetY,
      effectiveWidth,
      effectiveHeight
    );

    if (pendingPixel) {
      ctx.fillStyle = pendingPixel.color || '#FFFFFF';
      const pendingPosX = offsetX + pendingPixel.x * pixelSize;
      const pendingPosY = offsetY + pendingPixel.y * pixelSize;
      const alignedX = Math.floor(pendingPosX);
      const alignedY = Math.floor(pendingPosY);
      ctx.fillRect(alignedX, alignedY, pixelSize, pixelSize);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(alignedX, alignedY, pixelSize, pixelSize);
      ctx.globalAlpha = 1.0;
    }

    if (selectedColorValue && previewX !== null && previewY !== null) {
      // Calculer la position exacte sans arrondi excessif pour la prévisualisation
      const previewPosX = offsetX + previewX * pixelSize;
      const previewPosY = offsetY + previewY * pixelSize;
      const alignedX = Math.round(previewPosX); // Utilisation de Math.round pour plus de précision
      const alignedY = Math.round(previewPosY);

      // Remplissage avec la couleur sélectionnée
      ctx.fillStyle = selectedColorValue;
      ctx.fillRect(alignedX, alignedY, pixelSize, pixelSize);

      // Ajout de la bordure (taille initiale)
      ctx.strokeStyle = '#000000'; // Couleur de la bordure
      ctx.lineWidth = pixelSize * 0.1; // Remise à la taille initiale (10%)
      ctx.strokeRect(alignedX, alignedY, pixelSize, pixelSize);
    }
  };

  useEffect(() => {
    drawOffscreenCanvas();
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  }, [canvasData, isLoaded, pendingPixel]);

  useEffect(() => {
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  }, [scale, translatePos, containerSize, selectedColorValue]);

  const handleWheel = (e) => {
    e.preventDefault();
    const oldScale = scale;
    const scaleMultiplier = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(scale * scaleMultiplier, 1), 9);

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
    setTranslatePos(adjustTranslatePosOnZoom(newScale, oldScale));
  };

  const handleMouseDown = (e) => {
    setMouseDown(true);
    startDragOffset.current = { x: e.clientX - translatePos.x, y: e.clientY - translatePos.y };
  };

  const handleMouseUp = () => {
    setMouseDown(false);
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  };

  const handleMouseOut = () => {
    setMouseDown(false);
    mousePixel.current = null;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    drawCanvas();
  };

  const handleMouseMove = (e) => {
    if (mouseDown) {
      const newTranslatePos = {
        x: e.clientX - startDragOffset.current.x,
        y: e.clientY - startDragOffset.current.y
      };
      setTranslatePos(clampTranslatePos(newTranslatePos, scale));
      return;
    }

    if (!canvasRef.current || !isLoaded) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
    const pixelSize = basePixelSize * scale;
    const effectiveWidth = GRID_WIDTH * pixelSize;
    const effectiveHeight = GRID_HEIGHT * pixelSize;
    const offsetX = containerSize.width / 2 + translatePos.x - effectiveWidth / 2;
    const offsetY = containerSize.height / 2 + translatePos.y - effectiveHeight / 2;

    const canvasX = Math.floor((mouseX - offsetX) / pixelSize);
    const canvasY = Math.floor((mouseY - offsetY) / pixelSize);

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

  const fetchRemainingCredits = async () => {
    if (!publicKey) return;
    const [pixelCreditPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pixel-credit'), publicKey.toBuffer()],
      PROGRAM_ID
    );
    try {
      const accountInfo = await connection.getAccountInfo(pixelCreditPda);
      if (accountInfo) {
        const data = accountInfo.data;
        const remaining = data.readUInt8(40);
        setRemainingCredits(remaining);
        const sessionKeyBytes = data.slice(41, 73);
        const onChainSessionKey = new PublicKey(sessionKeyBytes).toBase58();
        if (remaining > 0 && onChainSessionKey !== PublicKey.default.toBase58()) {
          setSessionKey(onChainSessionKey);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'sync_session', sessionKey: onChainSessionKey }));
          }
        } else {
          setSessionKey(null);
          setRemainingCredits(0);
        }
      } else {
        setRemainingCredits(0);
        setSessionKey(null);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
      addToast('Error fetching credits', 'error');
    }
  };

  useEffect(() => {
    if (publicKey) fetchRemainingCredits();
  }, [publicKey]);

  const handleBuyCredits = async (amount) => {
    console.log('Starting handleBuyCredits...');
    if (!publicKey) {
      addToast('Wallet not connected', 'error');
      console.log('Wallet not connected');
      return;
    }

    console.log('Public Key (wallet):', publicKey.toBase58());
    console.log('Using RPC:', CLUSTER_URL);

    const sessionKeypair = Keypair.generate();
    const [pixelCreditPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('pixel-credit'), publicKey.toBuffer()],
      PROGRAM_ID
    );
    console.log('PixelCreditPda:', pixelCreditPda.toBase58());
    console.log('Session Key (generated):', sessionKeypair.publicKey.toBase58());

    const data = Buffer.concat([
      Buffer.from("0ead3a26f8eb7366", "hex"), // Instruction discriminator
      Buffer.from([amount]),
      sessionKeypair.publicKey.toBuffer()
    ]);

    try {
      console.log('Fetching wallet balance for:', publicKey.toBase58());
      const balance = await connection.getBalance(publicKey);
      console.log('Raw balance (lamports):', balance);
      console.log('Wallet balance:', balance / WEI_PER_ETH, 'SOL');

      const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(0);
      console.log('Rent exempt lamports for Eclipse:', rentExemptLamports);
      const totalCost = amount * LAMPORTS_PER_CREDIT + TX_FEE_ECLIPSE + rentExemptLamports;
      console.log('Required lamports:', totalCost);
      console.log('Required SOL:', totalCost / WEI_PER_ETH);

      if (balance < totalCost) {
        throw new Error(`Insufficient funds, need ${(totalCost / WEI_PER_ETH).toFixed(6)} SOL`);
      }

      console.log('Building transaction...');
      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 400_000
        })
      );

      console.log('Adding funding transfer for sessionKeypair...');
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: sessionKeypair.publicKey,
          lamports: amount * LAMPORTS_PER_CREDIT + rentExemptLamports
        })
      );

      transaction.add(
        new TransactionInstruction({
          keys: [
            { pubkey: pixelCreditPda, isSigner: false, isWritable: true },       // pixel_credit
            { pubkey: publicKey, isSigner: true, isWritable: true },            // owner
            { pubkey: sessionKeypair.publicKey, isSigner: false, isWritable: true }, // session_key
            { pubkey: TREASURY_PUBLIC_KEY, isSigner: false, isWritable: true },  // recipient
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }  // system_program
          ],
          programId: PROGRAM_ID,
          data
        })
      );

      console.log('Simulating transaction locally...');
      const simStart = Date.now();
      const { blockhash: simBlockhash, lastValidBlockHeight: simLastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = simBlockhash;
      transaction.feePayer = publicKey;
      const simulationResult = await connection.simulateTransaction(transaction);
      console.log('Simulation took:', Date.now() - simStart, 'ms');
      console.log('Simulation result:', JSON.stringify(simulationResult));
      if (simulationResult.value.err) {
        throw new Error(`Local simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
      }

      console.log('Fetching fresh blockhash for sendTransaction...');
      const sendStart = Date.now();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      console.log('Blockhash fetch took:', Date.now() - sendStart, 'ms');
      console.log('Blockhash:', blockhash);

      console.log('Sending transaction with Backpack simulation...');
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 5
      });
      console.log('Transaction signature:', signature);

      console.log('Confirming transaction...');
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('Transaction confirmed');
      addToast(`Successfully bought ${amount} credits`, 'success');
      setSessionKey(sessionKeypair.publicKey.toBase58());
      setRemainingCredits(prev => prev + amount);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'sync_session', sessionKey: sessionKeypair.publicKey.toBase58() }));
      }
      setShowBuyCreditsModal(false);
      fetchRemainingCredits();
    } catch (error) {
      console.error('Transaction error:', error);
      addToast(`Error buying credits: ${error.message}`, 'error');
      if (error instanceof SendTransactionError) {
        console.log('Transaction logs:', error.logs || 'No logs available');
      }
    }
  };

  const handleDrawPixel = async () => {
    const selectedPixel = mousePixel.current;
    if (!selectedPixel || !publicKey || !sessionKey) {
      addToast('Connect wallet and buy credits first', 'error');
      return;
    }

    if (!isLoaded) {
      addToast('Canvas not loaded', 'error');
      return;
    }

    if (selectedColorValue === null) {
      addToast('Select a color', 'warning');
      return;
    }

    if (remainingCredits <= 0) {
      addToast('No credits remaining. Please buy more.', 'error');
      setShowBuyCreditsModal(true);
      return;
    }

    // Mettre à jour le canvas localement immédiatement
    setCanvasData(prev => {
      const newCanvas = [...prev];
      newCanvas[selectedPixel.x][selectedPixel.y] = selectedColorValue;
      return newCanvas;
    });

    // Décrémenter les crédits immédiatement
    setRemainingCredits(prev => prev - 1);
    addToast('Pixel added', 'success');

    // Vérifier si les crédits sont épuisés
    if (remainingCredits - 1 === 0) {
      setSessionKey(null);
      addToast('Session expired. Please buy more credits.', 'info');
      setShowBuyCreditsModal(true);
    }

    // Envoyer la mise à jour au serveur en arrière-plan
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'update',
        data: { x: selectedPixel.x, y: selectedPixel.y, color: selectedColorValue },
        sessionKey: sessionKey
      }));
    } else {
      addToast('Not connected to server', 'error');
    }

    // Mettre à jour les crédits après un délai
    setTimeout(fetchRemainingCredits, 1000);
  };

  const handleCanvasClick = async (e) => {
    e.preventDefault();
    if (!mousePixel.current) return;

    if (!publicKey) {
      addToast('Please connect your wallet to add a pixel', 'error');
      return;
    }

    addToast('Adding pixel...', 'info');
    await handleDrawPixel();
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
        const oldScale = scale;
        const scaleFactor = distance / lastPinchDistanceRef.current;
        const newScale = Math.min(Math.max(scale * scaleFactor, 1), 9);
        const center = pinchCenterRef.current;

        const mouseCanvasX = center.x - (containerSize.width / 2 + translatePos.x);
        const mouseCanvasY = center.y - (containerSize.height / 2 + translatePos.y);

        const newTranslatePos = {
          x: translatePos.x + mouseCanvasX * (1 - newScale / scale),
          y: translatePos.y + mouseCanvasY * (1 - newScale / scale)
        };

        setScale(newScale);
        setTranslatePos(adjustTranslatePosOnZoom(newScale, oldScale));
      }
      lastPinchDistanceRef.current = distance;
    } else if (e.touches.length === 1 && mouseDown) {
      const newTranslatePos = {
        x: e.touches[0].clientX - startDragOffset.current.x,
        y: e.touches[0].clientY - startDragOffset.current.y
      };
      setTranslatePos(clampTranslatePos(newTranslatePos, scale));
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

  const handleColorSelect = (index, colorValue) => {
    if (!publicKey) {
      addToast('Please connect your wallet to select a color', 'error');
      return;
    }
    setSelectedColor(index);
    setSelectedColorValue(colorValue);
    addToast(
      `Color ${colorValue === null ? 'deselected' : 'selected'}: ${colorValue === null ? 'None' : colorValue}`,
      'info'
    );
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  };

  const handleOpenBuyCreditsModal = () => {
    setShowBuyCreditsModal(true);
  };

  const handleZoomIn = () => {
    const oldScale = scale;
    const newScale = Math.min(scale * 1.2, 9);
    setScale(newScale);
    setTranslatePos(adjustTranslatePosOnZoom(newScale, oldScale));
  };

  const handleZoomOut = () => {
    const oldScale = scale;
    const newScale = Math.max(scale / 1.2, 1);
    setScale(newScale);
    setTranslatePos(adjustTranslatePosOnZoom(newScale, oldScale));
  };

  return (
    <div className="App">
      <div className="header">
        <h1>Eclipse Pixel War</h1>
        <div className="wallet-container">
          <Link to="/free-version" className="free-version-button">Try Free Version</Link>
          <WalletMultiButton />
        </div>
      </div>
      <div className="main-content">
        <div style={{ display: !isLoaded ? "block" : "none" }}>
          <h2>Loading...</h2>
        </div>
        <div style={{ display: isLoaded ? "block" : "none" }} className="game-container">
          <div className="canvas-and-controls">
            <div className="canvas-wrapper">
              <div className="top-bar">
                <div className="color-picker-container" ref={colorPickerContainerRef}>
                  <ColorPicker
                    colors={COLORS}
                    onSelect={handleColorSelect}
                    selectedColor={selectedColor}
                  />
                </div>
              </div>
              <div
                ref={containerRef}
                className="canvas-container"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseOut={handleMouseOut}
                onMouseMove={handleMouseMove}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={handleCanvasClick}
              >
                <canvas
                  ref={canvasRef}
                  className={`pixel-canvas ${selectedColorValue === null ? 'crosshair' : ''}`}
                  onContextMenu={(e) => e.preventDefault()}
                />
              </div>
            </div>
            <div className="right-sidebar">
              <div className="zoom-controls">
                <span className="zoom-info">Zoom: {Math.round(scale * 100)}%</span>
                <div className="zoom-buttons">
                  <button onClick={handleZoomIn}>+</button>
                  <button onClick={handleZoomOut}>-</button>
                  <button onClick={resetCanvasPosition} title="Reset canvas">⟳</button>
                </div>
              </div>
              <div className="credits-controls">
                <span className="credits-info">Remaining Credits: {remainingCredits}</span>
                {remainingCredits === 0 && (
                  <div className="credits-buttons">
                    <button className="zoom-btn" onClick={handleOpenBuyCreditsModal}>Buy Credits</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {showBuyCreditsModal && (
        <BuyCreditsModal
          onClose={() => setShowBuyCreditsModal(false)}
          onBuyCredits={handleBuyCredits}
          connection={connection}
        />
      )}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/free-version" element={<FreeVersionCanvas />} />
    </Routes>
  );
}

export default App;