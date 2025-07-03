import React, { useEffect, useState, useRef } from 'react';
import ColorPicker from './ColorPicker';
import './App.css';
import { Link } from 'react-router-dom';

const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#808080', '#800000', '#008000', '#000080', '#FFA500', '#800080', '#C0C0C0', '#FFD700'
];

const GRID_WIDTH = 200;
const GRID_HEIGHT = 200;

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

function FreeVersionCanvas() {
  const [canvasData, setCanvasData] = useState(() => {
    const savedCanvas = localStorage.getItem('freePixelWarCanvas');
    if (savedCanvas) {
      return JSON.parse(savedCanvas);
    } else {
      // Initialize with white pixels
      const initialCanvas = Array(GRID_WIDTH).fill(null).map(() => Array(GRID_HEIGHT).fill('#FFFFFF'));
      return initialCanvas;
    }
  });
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedColorValue, setSelectedColorValue] = useState(null);
  const [isLoaded, setLoaded] = useState(false);
  const mousePixel = useRef(null);
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
  const [activeTool, setActiveTool] = useState('pixel'); // Default tool is 'pixel'
  const [lineStartPoint, setLineStartPoint] = useState(null); // For 'line' tool

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

  const floodFill = (startX, startY, targetColor, newColor) => {
    if (targetColor === newColor) return;

    const queue = [[startX, startY]];
    const visited = new Set();
    const newCanvasData = JSON.parse(JSON.stringify(canvasData)); // Deep copy

    const getPixelColor = (x, y) => newCanvasData[x] && newCanvasData[x][y];
    const setPixelColor = (x, y, c) => {
      if (newCanvasData[x]) {
        newCanvasData[x][y] = c;
      }
    };

    const isValid = (x, y) => {
      return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
    };

    while (queue.length > 0) {
      const [x, y] = queue.shift();
      const pixelKey = `${x},${y}`;

      if (visited.has(pixelKey)) continue;
      visited.add(pixelKey);

      if (isValid(x, y) && getPixelColor(x, y) === targetColor) {
        setPixelColor(x, y, newColor);

        // Add neighbors to the queue
        if (isValid(x + 1, y)) queue.push([x + 1, y]);
        if (isValid(x - 1, y)) queue.push([x - 1, y]);
        if (isValid(x, y + 1)) queue.push([x, y + 1]);
        if (isValid(x, y - 1)) queue.push([x, y - 1]);
      }
    }
    setCanvasData(newCanvasData);
    addToast('Fill completed', 'success');
  };

  // New: Bresenham's Line Algorithm
  const drawLine = (x0, y0, x1, y1, color) => {
    const newCanvasData = JSON.parse(JSON.stringify(canvasData));
    const setPixel = (x, y, c) => {
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        newCanvasData[x][y] = c;
      }
    };

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    while (true) {
      setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    setCanvasData(newCanvasData);
    addToast('Line drawn', 'success');
  };

  // New: Eyedropper tool logic
  const handleEyedropper = (x, y) => {
    const pixelColor = canvasData[x][y];
    if (pixelColor) {
      const colorIndex = COLORS.indexOf(pixelColor.toUpperCase());
      if (colorIndex !== -1) {
        setSelectedColor(colorIndex);
        setSelectedColorValue(pixelColor);
        addToast(`Color picked: ${pixelColor}`, 'info');
      } else {
        // If color is not in predefined COLORS, just select it
        setSelectedColor(null); // Deselect predefined color
        setSelectedColorValue(pixelColor);
        addToast(`Custom color picked: ${pixelColor}`, 'info');
      }
    }
    setActiveTool('pixel'); // Switch back to pixel tool after picking color
  };

  // New: Eraser tool logic
  const handleErasePixel = (x, y) => {
    const newCanvasData = JSON.parse(JSON.stringify(canvasData));
    if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
      newCanvasData[x][y] = '#FFFFFF'; // Erase to white
      setCanvasData(newCanvasData);
      addToast('Pixel erased', 'success');
    }
  };

  useEffect(() => {
    offscreenCanvasRef.current = document.createElement('canvas');
    offscreenCanvasRef.current.width = GRID_WIDTH;
    offscreenCanvasRef.current.height = GRID_HEIGHT;
    setLoaded(true);
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
    drawOffscreenCanvas();
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
    localStorage.setItem('freePixelWarCanvas', JSON.stringify(canvasData));
  }, [canvasData, isLoaded]);

  useEffect(() => {
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
  }, [scale, translatePos, containerSize, selectedColorValue]);

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

    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        offscreenCtx.fillStyle = canvasData[x][y] || '#FFFFFF';
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

    if (selectedColorValue && previewX !== null && previewY !== null) {
      const previewPosX = offsetX + previewX * pixelSize;
      const previewPosY = offsetY + previewY * pixelSize;
      const alignedX = Math.round(previewPosX);
      const alignedY = Math.round(previewPosY);

      ctx.fillStyle = selectedColorValue;
      ctx.fillRect(alignedX, alignedY, pixelSize, pixelSize);

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = pixelSize * 0.1;
      ctx.strokeRect(alignedX, alignedY, pixelSize, pixelSize);
    }
  };

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

  const handleDrawPixel = () => {
    const selectedPixel = mousePixel.current;
    if (!selectedPixel) {
      addToast('Select a pixel to draw', 'error');
      return;
    }

    if (selectedColorValue === null) {
      addToast('Select a color', 'warning');
      return;
    }

    setCanvasData(prev => {
      const newCanvas = [...prev];
      newCanvas[selectedPixel.x][selectedPixel.y] = selectedColorValue;
      return newCanvas;
    });
    addToast('Pixel added', 'success');
  };

  const handleCanvasClick = (e) => {
    e.preventDefault();
    if (!mousePixel.current) return;

    const { x, y } = mousePixel.current;

    if (selectedColorValue === null && activeTool !== 'eyedropper' && activeTool !== 'eraser') {
      addToast('Select a color first', 'warning');
      return;
    }

    switch (activeTool) {
      case 'pixel':
        handleDrawPixel();
        break;
      case 'fill':
        const targetColor = canvasData[x][y];
        floodFill(x, y, targetColor, selectedColorValue);
        break;
      case 'line':
        if (!lineStartPoint) {
          setLineStartPoint({ x, y });
          addToast('Line start point set. Click again for end point.', 'info');
        } else {
          drawLine(lineStartPoint.x, lineStartPoint.y, x, y, selectedColorValue);
          setLineStartPoint(null);
          addToast('Line drawn', 'success');
        }
        break;
      case 'eyedropper':
        handleEyedropper(x, y);
        break;
      case 'eraser':
        handleErasePixel(x, y);
        break;
      default:
        break;
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
        y: e.touches[0].clientY - translatePos.y
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
    setSelectedColor(index);
    setSelectedColorValue(colorValue);
    addToast(
      `Color ${colorValue === null ? 'deselected' : 'selected'}: ${colorValue === null ? 'None' : colorValue}`,
      'info'
    );
    drawCanvas(mousePixel.current?.x, mousePixel.current?.y);
    // If eyedropper was active, switch back to pixel tool
    if (activeTool === 'eyedropper') {
      setActiveTool('pixel');
    }
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
        <h1>Free Pixel War</h1>
        <div className="wallet-container">
          <Link to="/" className="free-version-button">Back to Main Version</Link>
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
              {/* New Tool Buttons */}
              <button
                onClick={() => setActiveTool('pixel')}
                className={`tool-btn ${activeTool === 'pixel' ? 'active' : ''}`}
                title="Pixel Tool"
              >
                Pixel
              </button>
              <button
                onClick={() => setActiveTool('fill')}
                className={`tool-btn ${activeTool === 'fill' ? 'active' : ''}`}
                title="Fill Tool"
              >
                Fill
              </button>
              <button
                onClick={() => { setActiveTool('line'); setLineStartPoint(null); }}
                className={`tool-btn ${activeTool === 'line' ? 'active' : ''}`}
                title="Line Tool"
              >
                Line
              </button>
              <button
                onClick={() => setActiveTool('eyedropper')}
                className={`tool-btn ${activeTool === 'eyedropper' ? 'active' : ''}`}
                title="Eyedropper Tool"
              >
                Eye
              </button>
              <button
                onClick={() => setActiveTool('eraser')}
                className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}
                title="Eraser Tool"
              >
                Eraser
              </button>
              {/* End New Tool Buttons */}

              <div className="zoom-controls">
                <span className="zoom-info">Zoom: {Math.round(scale * 100)}%</span>
                <div className="zoom-buttons">
                  <button onClick={handleZoomIn}>+</button>
                  <button onClick={handleZoomOut}>-</button>
                  <button onClick={resetCanvasPosition} title="Reset canvas">⟳</button>
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

export default FreeVersionCanvas;