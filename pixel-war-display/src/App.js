import React, { useEffect, useState, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import ColorPicker from './ColorPicker';
import './App.css';

// Configuration de base
const PROGRAM_ID = new PublicKey('HAGwaTLgWF5tgjmZzWU42oq9eLXvwLmYSmKfS5Q3zCXs');
const CLUSTER_URL = 'https://staging-rpc.dev2.eclipsenetwork.xyz';
const WS_URL = 'ws://localhost:8080';

const COLORS = [
    '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;
const BASE_PAN_LIMIT = 100;

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

function App() {
    const { connection } = useConnection();
    const { publicKey, sendTransaction } = useWallet();
    const [canvasData, setCanvasData] = useState(null);
    const [sessionKey, setSessionKey] = useState(null);
    const canvasRef = useRef(null);
    const offscreenCanvasRef = useRef(null);
    const [selectedColor, setSelectedColor] = useState(null);
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

    const addToast = (message, type = 'info') => {
        const id = toastIdCounter.current++;
        setToasts(prev => {
            // Si on a déjà 2 toasts, on supprime le plus ancien (le premier de la liste)
            if (prev.length >= 2) {
                const newToasts = prev.slice(1); // Supprime le premier toast
                return [...newToasts, { id, message, type }];
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
            setContainerSize({ width, height });
            setColorPickerWidth(width);
            setTranslatePos({ x: 0, y: 0 });
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
        const ws = new WebSocket(WS_URL);
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
            if (isActive) addToast('Disconnected from server', 'error');
        };

        ws.onerror = (error) => {
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
    }, []);

    const clampTranslatePos = (pos) => {
        const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
        const pixelSize = basePixelSize * scale;
        const effectiveCanvasWidth = GRID_WIDTH * pixelSize;
        const effectiveCanvasHeight = GRID_HEIGHT * pixelSize;

        const maxOffsetX = Math.max(0, (effectiveCanvasWidth - containerSize.width) / 2);
        const maxOffsetY = Math.max(0, (effectiveCanvasHeight - containerSize.height) / 2);

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
                offscreenCtx.fillStyle = COLORS[canvasData[x][y]] || '#FFFFFF';
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
        let effectiveWidth = GRID_WIDTH * pixelSize;
        let effectiveHeight = GRID_HEIGHT * pixelSize;

        if (effectiveWidth < containerSize.width || effectiveHeight < containerSize.height) {
            const scaleToFit = Math.max(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
            effectiveWidth = GRID_WIDTH * scaleToFit * scale;
            effectiveHeight = GRID_HEIGHT * scaleToFit * scale;
        }

        const offsetX = Math.round(containerSize.width / 2 + translatePos.x - effectiveWidth / 2);
        const offsetY = Math.round(containerSize.height / 2 + translatePos.y - effectiveHeight / 2);

        ctx.drawImage(offscreenCanvasRef.current, 0, 0, GRID_WIDTH, GRID_HEIGHT, offsetX, offsetY, effectiveWidth, effectiveHeight);

        if (selectedColor !== null && previewX !== null && previewY !== null) {
            ctx.fillStyle = COLORS[selectedColor] || '#FFFFFF';
            const previewPosX = offsetX + previewX * pixelSize;
            const previewPosY = offsetY + previewY * pixelSize;
            ctx.fillRect(Math.round(previewPosX), Math.round(previewPosY), Math.round(pixelSize), Math.round(pixelSize));
        }
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
        setTranslatePos(clampTranslatePos(newTranslatePos));
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
            setTranslatePos(clampTranslatePos(newTranslatePos));
            return;
        }

        if (!canvasRef.current || !isLoaded) return;

        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const basePixelSize = Math.min(containerSize.width / GRID_WIDTH, containerSize.height / GRID_HEIGHT);
        const pixelSize = basePixelSize * scale;
        const effectiveWidth = Math.round(GRID_WIDTH * pixelSize);
        const effectiveHeight = Math.round(GRID_HEIGHT * pixelSize);
        const offsetX = Math.round(containerSize.width / 2 + translatePos.x - effectiveWidth / 2);
        const offsetY = Math.round(containerSize.height / 2 + translatePos.y - effectiveHeight / 2);

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
                console.log('Remaining Credits from chain:', remaining);
                setRemainingCredits(remaining);
                const sessionKeyBytes = data.slice(41, 73);
                const sessionKeyPubkey = new PublicKey(sessionKeyBytes);
                console.log('Session Key from chain:', sessionKeyPubkey.toBase58());

                const storedSessionKey = localStorage.getItem('sessionKey');
                if (storedSessionKey && remaining > 0 && !sessionKeyPubkey.equals(PublicKey.default)) {
                    const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(storedSessionKey)));
                    if (keypair.publicKey.equals(sessionKeyPubkey)) {
                        setSessionKey(keypair);
                        console.log('Session Key restored from localStorage:', keypair.publicKey.toBase58());
                    } else {
                        console.log('Stored session key does not match on-chain key');
                        setSessionKey(null);
                        localStorage.removeItem('sessionKey');
                    }
                } else {
                    console.log('No valid session key on chain or no credits');
                    setSessionKey(null);
                    localStorage.removeItem('sessionKey');
                }
            } else {
                console.log('PixelCredit account not found');
                setRemainingCredits(0);
                setSessionKey(null);
                localStorage.removeItem('sessionKey');
            }
        } catch (error) {
            console.error('Error fetching credits:', error);
            setRemainingCredits(0);
            setSessionKey(null);
            localStorage.removeItem('sessionKey');
        }
    };

    useEffect(() => {
        if (publicKey) fetchRemainingCredits();
    }, [publicKey]);

    const handleBuyCredits = async () => {
        if (!publicKey) {
            addToast('Wallet not connected', 'error');
            return;
        }

        const newSessionKey = Keypair.generate();
        console.log('New Session Key Public:', newSessionKey.publicKey.toBase58());
        localStorage.setItem('sessionKey', JSON.stringify(Array.from(newSessionKey.secretKey)));
        console.log('Session Key stored in localStorage');

        const recipientPubkey = new PublicKey('EiogKSRa3tQJXyFrQqecc5z8DHNwjAn8pdR61yTKdLaP');
        const [pixelCreditPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('pixel-credit'), publicKey.toBuffer()],
            PROGRAM_ID
        );

        const transaction = new Transaction();

        const lamportsToSend = 10000000;
        const transferIx = SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: newSessionKey.publicKey,
            lamports: lamportsToSend,
        });
        transaction.add(transferIx);

        const data = Buffer.alloc(41);
        Buffer.from([236, 132, 140, 248, 22, 186, 122, 234]).copy(data, 0);
        data.writeUInt8(10, 8);
        newSessionKey.publicKey.toBuffer().copy(data, 9);

        const buyCreditsIx = new TransactionInstruction({
            keys: [
                { pubkey: pixelCreditPda, isSigner: false, isWritable: true },
                { pubkey: publicKey, isSigner: true, isWritable: true },
                { pubkey: recipientPubkey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: data,
        });
        transaction.add(buyCreditsIx);

        try {
            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'confirmed');
            addToast('Successfully bought 10 credits and funded session key', 'success');
            setSessionKey(newSessionKey);
            console.log('Session Key set in state:', newSessionKey.publicKey.toBase58());
            await new Promise(resolve => setTimeout(resolve, 1000));
            await fetchRemainingCredits();
        } catch (error) {
            addToast(`Error buying credits: ${error.message}`, 'error');
            localStorage.removeItem('sessionKey');
        }
    };

    const handleDrawPixel = async () => {
        const selectedPixel = mousePixel.current;
        if (!selectedPixel || !publicKey) return;

        if (!isLoaded) {
            addToast('Canvas not loaded', 'error');
            return;
        }

        if (selectedColor === null) {
            addToast('Select a color', 'warning');
            return;
        }

        console.log('Session Key:', sessionKey ? sessionKey.publicKey.toBase58() : 'null');
        console.log('Remaining Credits:', remainingCredits);
        if (!sessionKey || remainingCredits <= 0) {
            addToast('No valid session or credits. Please buy credits.', 'error');
            return;
        }

        const quadrant = Math.floor(selectedPixel.x / 100) + Math.floor(selectedPixel.y / 100) * 2;
        const subX = Math.floor((selectedPixel.x % 100) / 10);
        const subY = Math.floor((selectedPixel.y % 100) / 10);
        const pixelX = selectedPixel.x % 10;
        const pixelY = selectedPixel.y % 10;

        const [subsectionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('subsection'), Buffer.from([quadrant]), Buffer.from([subX]), Buffer.from([subY])],
            PROGRAM_ID
        );
        const [pixelCreditPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('pixel-credit'), publicKey.toBuffer()],
            PROGRAM_ID
        );

        const pixel = { x: pixelX, y: pixelY, color: selectedColor };
        const data = Buffer.alloc(15);
        Buffer.from([180, 185, 58, 15, 109, 2, 112, 85]).copy(data, 0);
        data.writeUInt32LE(1, 8);
        data.writeUInt8(pixel.x, 12);
        data.writeUInt8(pixel.y, 13);
        data.writeUInt8(pixel.color, 14);

        const drawPixelsIx = new TransactionInstruction({
            keys: [
                { pubkey: subsectionPda, isSigner: false, isWritable: true },
                { pubkey: pixelCreditPda, isSigner: false, isWritable: true },
                { pubkey: sessionKey.publicKey, isSigner: true, isWritable: false },
                { pubkey: publicKey, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: data,
        });

        const transaction = new Transaction().add(drawPixelsIx);
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = sessionKey.publicKey;

        try {
            transaction.sign(sessionKey);
            const signature = await connection.sendRawTransaction(transaction.serialize());
            await connection.confirmTransaction(signature, 'confirmed');
            const newCanvas = [...canvasData];
            newCanvas[selectedPixel.x][selectedPixel.y] = selectedColor;
            setCanvasData(newCanvas);
            setRemainingCredits(prev => prev - 1);
            if (remainingCredits - 1 === 0) {
                setSessionKey(null);
                localStorage.removeItem('sessionKey');
                addToast('Session expired. Please buy more credits.', 'info');
            } else {
                addToast('Pixel added successfully', 'success');
            }

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'update',
                    data: { x: selectedPixel.x, y: selectedPixel.y, color: selectedColor }
                }));
            }
        } catch (error) {
            addToast(`Error: ${error.message || 'Transaction failed'}`, 'error');
        }
    };

    const handleCanvasClick = async (e) => {
        e.preventDefault();
        if (!mousePixel.current) return;
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
            <div className="header">
                <h1>Eclipse Pixel War</h1>
                <div className="wallet-container">
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
                                    className={`pixel-canvas ${selectedColor === null ? 'crosshair' : ''}`}
                                    onContextMenu={(e) => e.preventDefault()}
                                />
                            </div>
                        </div>
                        <div className="right-sidebar">
                            <div className="zoom-controls">
                                <span className="zoom-info">Zoom: {Math.round(scale * 100)}%</span>
                                <div className="zoom-buttons">
                                    <button onClick={() => {
                                        const newScale = Math.min(scale * 1.2, 9);
                                        setScale(newScale);
                                        setTranslatePos(clampTranslatePos(translatePos));
                                    }}>+</button>
                                    <button onClick={() => {
                                        const newScale = Math.max(scale / 1.2, 1);
                                        setScale(newScale);
                                        setTranslatePos(clampTranslatePos(translatePos));
                                    }}>-</button>
                                    <button onClick={resetCanvasPosition} title="Reset canvas">⟳</button>
                                </div>
                            </div>
                            <div className="credits-controls">
                                <span className="credits-info">Remaining Credits: {remainingCredits}</span>
                                <div className="credits-buttons">
                                    <button className="zoom-btn" onClick={handleBuyCredits}>Buy 10 Credits</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}

export default App;