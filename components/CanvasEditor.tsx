
import React, { useRef, useState, useEffect } from 'react';
import { Save, Undo, Brush, Eraser, Square, MousePointer2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CanvasEditorProps {
  imageUrl: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

type ToolType = 'brush' | 'rect' | 'marker';

interface HistoryItem {
  imageData: ImageData;
  labelIndex: number;
}

const MARKER_CURSOR = `crosshair`;

export const CanvasEditor: React.FC<CanvasEditorProps> = ({ imageUrl, onSave, onClose }) => {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Tools
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [brushSize, setBrushSize] = useState(5); // Default to Fine
  const [brushColor, setBrushColor] = useState('#3b82f6'); // Default Blue
  
  // State
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [nextLabelIndex, setNextLabelIndex] = useState(1);
  
  // Viewport Transform State (for Pan/Zoom of the high-res canvas)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Rect Drawing Temp State
  const dragStartRef = useRef<{x: number, y: number} | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

  // Initialize Canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImgElement(img);
      initializeCanvas(img);
    };
  }, [imageUrl]);

  const initializeCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    // HIGH RES FIX: Set canvas dimensions to match the IMAGE'S NATIVE RESOLUTION
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Calculate initial display scale to fit the container
    const container = containerRef.current;
    const padding = 40;
    const maxWidth = container.clientWidth - padding;
    const maxHeight = container.clientHeight - padding;
    
    const scaleX = maxWidth / img.naturalWidth;
    const scaleY = maxHeight / img.naturalHeight;
    const initialScale = Math.min(scaleX, scaleY, 1); // Fit to screen
    
    setScale(initialScale);
    setOffset({ x: 0, y: 0 });

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      setNextLabelIndex(1);
      saveState(1); // Save initial state
    }
  };

  const saveState = (labelIndexOverride?: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const currentLabelIndex = labelIndexOverride !== undefined ? labelIndexOverride : nextLabelIndex;
      const newItem = {
         imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
         labelIndex: currentLabelIndex
      };

      if (history.length > 10) {
         setHistory(prev => [...prev.slice(1), newItem]);
      } else {
         setHistory(prev => [...prev, newItem]);
      }
    }
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx && history.length > 1) {
      const newHistory = [...history];
      newHistory.pop(); // Remove current state
      const previousState = newHistory[newHistory.length - 1];
      ctx.putImageData(previousState.imageData, 0, 0);
      setNextLabelIndex(previousState.labelIndex);
      setHistory(newHistory);
    }
  };

  // Convert screen coordinates to canvas coordinates (accounting for CSS transform)
  const getCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    return { x, y };
  };

  // --- Input Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button === 1 || e.shiftKey) {
          e.preventDefault();
          setIsPanning(true);
          setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
          return;
      }
      
      startDrawing(e);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isPanning) {
          e.preventDefault();
          setOffset({
              x: e.clientX - panStart.x,
              y: e.clientY - panStart.y
          });
          return;
      }
      
      draw(e);
  };

  const handleMouseUp = () => {
      if (isPanning) {
          setIsPanning(false);
          return;
      }
      stopDrawing();
  };

  const handleWheel = (e: React.WheelEvent) => {
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      const newScale = Math.min(Math.max(0.05, scale + delta), 5);
      setScale(newScale);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCanvasCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;

    if (ctx && canvas) {
      if (activeTool === 'brush') {
        setIsDrawing(true);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize; 
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = brushColor; 
      } else if (activeTool === 'rect') {
         setIsDrawing(true);
         dragStartRef.current = { x, y };
         snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } else if (activeTool === 'marker') {
         // Place marker immediately on click
         drawMarker(ctx, x, y, nextLabelIndex);
         
         // Auto-increment and save
         const newIndex = nextLabelIndex + 1;
         setNextLabelIndex(newIndex);
         saveState(newIndex);
      }
    }
  };

  const getDynamicScaleFactor = (ctx: CanvasRenderingContext2D) => {
      return Math.max(ctx.canvas.width, ctx.canvas.height) / 1024;
  };

  const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, index: number) => {
      // 1. Determine Dynamic Size based on Image Resolution
      const baseRadius = 16; 
      const scaleFactor = getDynamicScaleFactor(ctx);
      const radius = Math.max(14, baseRadius * scaleFactor);
      
      ctx.save();
      
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 8 * scaleFactor;
      ctx.shadowOffsetX = 2 * scaleFactor;
      ctx.shadowOffsetY = 2 * scaleFactor;

      // Circle Background
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.9)'; // Red-600
      ctx.fill();
      
      // White Border
      ctx.lineWidth = 2 * scaleFactor;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Text Number
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${radius * 1.2}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(index.toString(), x, y + (radius * 0.1));
      
      ctx.restore();
  };

  const drawRectLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, index: number) => {
      const scaleFactor = getDynamicScaleFactor(ctx);
      const padding = 8 * scaleFactor;
      const fontSize = 16 * scaleFactor;
      
      ctx.save();
      ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
      const text = index.toString();
      const metrics = ctx.measureText(text);
      const bgWidth = metrics.width + (padding * 2);
      const bgHeight = fontSize + (padding); // Approx height

      // Position label at top-left of rect, offset slightly up
      // If y is close to 0, push it inside the box so it's not cut off
      const labelX = x;
      const labelY = y < bgHeight ? y : y - bgHeight;

      // Draw Label Background (Red)
      ctx.fillStyle = 'rgba(220, 38, 38, 0.9)';
      ctx.fillRect(x, y, bgWidth, bgHeight);
      
      // Draw Label Text
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(text, x + padding, y + (padding/2));
      
      ctx.restore();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    
    const { x, y } = getCanvasCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;
    
    if (ctx && canvas) {
      if (activeTool === 'brush') {
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (activeTool === 'rect' && dragStartRef.current && snapshotRef.current) {
         ctx.putImageData(snapshotRef.current, 0, 0);
         
         const startX = dragStartRef.current.x;
         const startY = dragStartRef.current.y;
         const width = x - startX;
         const height = y - startY;

         // Translucent Box fill
         ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; 
         ctx.fillRect(startX, startY, width, height);

         // Solid border for visibility
         ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
         ctx.lineWidth = Math.max(2, canvas.width * 0.002);
         ctx.strokeRect(startX, startY, width, height);
      }
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const ctx = canvasRef.current?.getContext('2d');
      const newLabelIndex = nextLabelIndex + 1; // Always increment after an action for SoM uniqueness

      if (activeTool === 'brush') {
         ctx?.closePath();
         // Brush strokes are harder to auto-label without advanced logic, 
         // so we don't increment label for brush, just save state.
         saveState(nextLabelIndex);
      } else if (activeTool === 'rect') {
         // Auto-label the rectangle
         if (ctx && dragStartRef.current) {
             const x = Math.min(dragStartRef.current.x, getCanvasCoordinates(lastMouseEventRef.current!).x);
             const y = Math.min(dragStartRef.current.y, getCanvasCoordinates(lastMouseEventRef.current!).y);
             
             drawRectLabel(ctx, x, y, nextLabelIndex);
             
             setNextLabelIndex(newLabelIndex);
             saveState(newLabelIndex);
         }
         dragStartRef.current = null;
         snapshotRef.current = null;
      }
    }
  };
  
  // Track last mouse position for stopDrawing to access
  const lastMouseEventRef = useRef<React.MouseEvent | React.TouchEvent | null>(null);

  const handleSave = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      onSave(dataUrl);
      onClose();
    }
  };

  const handleClear = () => {
     if (imgElement) initializeCanvas(imgElement);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-panel z-10 shrink-0">
        <div className="flex items-center gap-2">
           <div className="p-2 bg-brand-500/20 rounded-lg">
             {activeTool === 'brush' && <Brush size={20} className="text-brand-500" />}
             {activeTool === 'rect' && <Square size={20} className="text-brand-500" />}
             {activeTool === 'marker' && <MousePointer2 size={20} className="text-brand-500" />}
           </div>
           <div>
             <h2 className="text-lg font-bold text-white">{t('editor.title')}</h2>
             <p className="text-xs text-gray-400">Shift+Drag to Pan • Scroll to Zoom</p>
           </div>
        </div>
        
        <div className="flex items-center gap-3">
           <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
             {t('editor.cancel')}
           </button>
           <button 
             onClick={handleSave}
             className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all"
           >
             <Save size={16} />
             {t('editor.use')}
           </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="h-14 border-b border-dark-border bg-dark-surface flex items-center justify-center gap-6 shrink-0 z-20">
         
         {/* Undo/Reset */}
         <div className="flex items-center gap-2 border-r border-dark-border pr-6">
            <button onClick={handleUndo} disabled={history.length <= 1} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 transition-colors" title={t('editor.undo')}>
               <Undo size={18} />
            </button>
            <button onClick={handleClear} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title={t('editor.reset')}>
               <Eraser size={18} />
            </button>
         </div>

         {/* Tools */}
         <div className="flex items-center gap-2 p-1 bg-black/20 rounded-lg border border-white/5">
             <button onClick={() => setActiveTool('marker')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'marker' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <MousePointer2 size={14} /> Markers (Click)
             </button>
             <button onClick={() => setActiveTool('brush')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'brush' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <Brush size={14} /> {t('editor.brush')}
             </button>
             <button onClick={() => setActiveTool('rect')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'rect' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <Square size={14} /> {t('editor.box')}
             </button>
         </div>

         {/* Brush Settings */}
         {activeTool === 'brush' && (
          <div className="flex items-center gap-4 border-l border-dark-border pl-6 animate-in slide-in-from-left-2 fade-in">
             {/* Color Picker */}
             <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase">{t('editor.color')}</label>
                <div className="relative w-6 h-6 rounded-full overflow-hidden border border-white/20 shadow-sm cursor-pointer hover:scale-110 transition-transform">
                   <input 
                      type="color" 
                      value={brushColor}
                      onChange={(e) => setBrushColor(e.target.value)}
                      className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] p-0 cursor-pointer border-0 outline-none"
                   />
                </div>
             </div>

             <div className="w-px h-6 bg-dark-border" />

             {/* Size Presets */}
             <div className="flex items-center gap-2">
                 <span className="text-xs font-bold text-gray-500 uppercase">{t('editor.size')}</span>
                 <div className="flex items-center bg-black/20 rounded-lg p-1 border border-white/5">
                    {[5, 15, 30].map((size) => (
                      <button 
                        key={size}
                        onClick={() => setBrushSize(size)}
                        className={`p-1.5 rounded-md hover:bg-white/10 transition-all ${brushSize === size ? 'bg-white/20' : ''}`}
                        title={size === 5 ? 'Fine' : size === 15 ? 'Medium' : 'Large'}
                      >
                         <div 
                            className={`rounded-full ${brushSize === size ? 'bg-white' : 'bg-gray-500'}`}
                            style={{ width: size === 30 ? 16 : size === 15 ? 10 : 4, height: size === 30 ? 16 : size === 15 ? 10 : 4 }}
                         />
                      </button>
                    ))}
                 </div>
             </div>
          </div>
         )}
      </div>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 bg-dark-bg/50 relative overflow-hidden flex items-center justify-center p-0 touch-none select-none`}
        style={{ cursor: activeTool === 'brush' ? 'crosshair' : activeTool === 'marker' ? MARKER_CURSOR : 'crosshair' }}
        onWheel={handleWheel}
      >
         <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

         <canvas 
           ref={canvasRef}
           onMouseDown={handleMouseDown}
           onMouseMove={(e) => { lastMouseEventRef.current = e; handleMouseMove(e); }}
           onMouseUp={handleMouseUp}
           onMouseLeave={handleMouseUp}
           onTouchStart={(e) => { lastMouseEventRef.current = e; startDrawing(e); }}
           onTouchMove={(e) => { lastMouseEventRef.current = e; draw(e); }}
           onTouchEnd={stopDrawing}
           style={{
               transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
               transformOrigin: 'center center',
               boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
               border: '1px solid rgba(255,255,255,0.1)'
           }}
         />
         
         {/* Toast Hint for Markers/Box */}
         {(activeTool === 'marker' || activeTool === 'rect') && (
             <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-white pointer-events-none border border-white/10">
                 {activeTool === 'marker' ? "Click objects to add numbered markers" : "Draw boxes to define numbered regions"}
             </div>
         )}
      </div>
    </div>
  );
};
