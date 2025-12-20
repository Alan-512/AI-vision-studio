
import React, { useRef, useState, useEffect } from 'react';
import { Save, Undo, Brush, Eraser, Square, MousePointer2, Move } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CanvasEditorProps {
  imageUrl: string;
  // Updated signature: returns composite, and optionally mask and original if needed
  onSave: (compositeDataUrl: string, maskDataUrl?: string) => void;
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
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null); // The scrollable/clippable viewport
  const contentRef = useRef<HTMLDivElement>(null);   // The transforming wrapper (scale/translate)
  const canvasRef = useRef<HTMLCanvasElement>(null); // The transparent drawing layer
  const bgImageRef = useRef<HTMLImageElement>(null); // The static background image
  
  // Tools
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [brushSize, setBrushSize] = useState(15); 
  const [brushColor, setBrushColor] = useState('#ef4444'); // Default Red-500
  
  // State
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [nextLabelIndex, setNextLabelIndex] = useState(1);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  
  // Viewport Transform State
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Rect Drawing Temp State
  const dragStartRef = useRef<{x: number, y: number} | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

  // Initialize Canvas Sizing once image loads
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setIsImageLoaded(true);
    
    if (canvasRef.current && containerRef.current) {
        // Match canvas resolution to native image resolution
        canvasRef.current.width = img.naturalWidth;
        canvasRef.current.height = img.naturalHeight;
        
        // Initial "Fit to Screen" Logic
        const container = containerRef.current;
        const padding = 60;
        const availableWidth = container.clientWidth - padding;
        const availableHeight = container.clientHeight - padding;
        
        const scaleX = availableWidth / img.naturalWidth;
        const scaleY = availableHeight / img.naturalHeight;
        const fitScale = Math.min(scaleX, scaleY, 0.9); // 0.9 to give breathing room
        
        setScale(fitScale);
        
        // Center the image
        const initialX = (container.clientWidth - (img.naturalWidth * fitScale)) / 2;
        const initialY = (container.clientHeight - (img.naturalHeight * fitScale)) / 2;
        // Adjust offset because transform-origin is center-center usually, but here we handle custom panning
        // Let's keep it simple: Start centered at (0,0) conceptually if using flex center
        setOffset({ x: 0, y: 0 });

        // Save initial blank state
        saveState(1);
    }
  };

  const saveState = (labelIndexOverride?: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const currentLabelIndex = labelIndexOverride !== undefined ? labelIndexOverride : nextLabelIndex;
      const newItem = {
         // We only save the drawing layer, NOT the background image. Lightweight and correct.
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
    } else if (history.length === 1) {
       // Clear to initial blank state
       ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Convert screen coordinates to canvas coordinates (accounting for CSS transform & resolution)
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

    // Map screen pixel to native image pixel
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    return { x, y };
  };

  // --- Input Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
      // Middle click or Space+Click (simulated) triggers pan
      if (e.button === 1 || e.shiftKey) {
          e.preventDefault();
          setIsPanning(true);
          setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
          return;
      }
      if (!isImageLoaded) return;
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
      const newScale = Math.min(Math.max(0.1, scale + delta), 5); // Limit zoom 0.1x to 5x
      setScale(newScale);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCanvasCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;

    if (ctx && canvas) {
      if (activeTool === 'brush' || activeTool === 'eraser') {
        setIsDrawing(true);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize; 
        
        if (activeTool === 'eraser') {
            // CRITICAL: This is what makes it "Non-Destructive". 
            // We are erasing the drawing layer to transparent, revealing the original image below.
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = brushColor; 
        }
      } else if (activeTool === 'rect') {
         setIsDrawing(true);
         ctx.globalCompositeOperation = 'source-over';
         dragStartRef.current = { x, y };
         snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } else if (activeTool === 'marker') {
         ctx.globalCompositeOperation = 'source-over';
         drawMarker(ctx, x, y, nextLabelIndex);
         const newIndex = nextLabelIndex + 1;
         setNextLabelIndex(newIndex);
         saveState(newIndex);
      }
    }
  };

  const getDynamicScaleFactor = (ctx: CanvasRenderingContext2D) => {
      // Scale UI elements (text, markers) so they look good on 4K images or small icons
      return Math.max(ctx.canvas.width, ctx.canvas.height) / 1500;
  };

  const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, index: number) => {
      const baseRadius = 24; 
      const scaleFactor = Math.max(1, getDynamicScaleFactor(ctx));
      const radius = baseRadius * scaleFactor;
      
      ctx.save();
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10 * scaleFactor;
      ctx.shadowOffsetY = 4 * scaleFactor;

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = brushColor; 
      ctx.fill();
      
      // Border
      ctx.lineWidth = 3 * scaleFactor;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Text
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${radius * 1.1}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(index.toString(), x, y + (radius * 0.1)); // optical center adj
      ctx.restore();
  };

  const drawRectLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, index: number) => {
      const scaleFactor = Math.max(1, getDynamicScaleFactor(ctx));
      const padding = 12 * scaleFactor;
      const fontSize = 24 * scaleFactor;
      
      ctx.save();
      ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
      const text = index.toString();
      const metrics = ctx.measureText(text);
      const bgWidth = metrics.width + (padding * 2);
      const bgHeight = fontSize + padding;

      // Ensure label stays within view roughly
      const labelX = x;
      const labelY = y < bgHeight ? y : y - bgHeight;

      ctx.fillStyle = brushColor;
      ctx.fillRect(labelX, labelY, bgWidth, bgHeight);
      
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(text, labelX + padding, labelY + (padding/2));
      
      ctx.restore();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    
    const { x, y } = getCanvasCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;
    
    if (ctx && canvas) {
      if (activeTool === 'brush' || activeTool === 'eraser') {
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (activeTool === 'rect' && dragStartRef.current && snapshotRef.current) {
         // Restore "pre-drag" state to avoid trails
         ctx.putImageData(snapshotRef.current, 0, 0);
         
         const startX = dragStartRef.current.x;
         const startY = dragStartRef.current.y;
         const width = x - startX;
         const height = y - startY;

         // Fill
         ctx.fillStyle = `${brushColor}33`; // 20% opacity hex
         ctx.fillRect(startX, startY, width, height);

         // Stroke
         ctx.strokeStyle = brushColor;
         ctx.lineWidth = Math.max(4, canvas.width * 0.003);
         ctx.strokeRect(startX, startY, width, height);
      }
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const ctx = canvasRef.current?.getContext('2d');
      const newLabelIndex = nextLabelIndex + 1;

      if (activeTool === 'brush' || activeTool === 'eraser') {
         ctx?.closePath();
         // Reset composite to default just in case
         if(ctx) ctx.globalCompositeOperation = 'source-over';
         saveState(nextLabelIndex);
      } else if (activeTool === 'rect') {
         if (ctx && dragStartRef.current) {
             // Re-calculate final box to draw label
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
  
  const lastMouseEventRef = useRef<React.MouseEvent | React.TouchEvent | null>(null);

  const generateMask = (drawingCanvas: HTMLCanvasElement): string => {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = drawingCanvas.width;
      maskCanvas.height = drawingCanvas.height;
      const ctx = maskCanvas.getContext('2d');
      
      if (!ctx) return '';

      // 1. Fill with Black (Background / Protected Area)
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

      // 2. Draw the transparent drawing layer
      // This puts colored strokes onto the black background
      ctx.drawImage(drawingCanvas, 0, 0);

      // 3. Convert colored strokes to White (The Mask Area)
      // Any pixel that is NOT black (meaning it has drawing) needs to become white.
      // We use 'source-in' composite operation with White fill to replace existing non-transparent pixels.
      // BUT, since we already drew on black, we need to be careful.
      // Better approach: 
      
      // A. Clear
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      
      // B. Draw drawing layer
      ctx.drawImage(drawingCanvas, 0, 0);
      
      // C. Set Composite to source-in and fill White. 
      // This turns all non-transparent pixels (brush strokes) to White.
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      
      // D. Set Composite to destination-over and fill Black.
      // This puts Black "behind" the now-white strokes.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      
      return maskCanvas.toDataURL('image/png');
  };

  const handleSave = () => {
    if (canvasRef.current && bgImageRef.current) {
        // 1. COMPOSITE IMAGE (Visual Preview)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasRef.current.width;
        tempCanvas.height = canvasRef.current.height;
        const tCtx = tempCanvas.getContext('2d');
        
        let compositeUrl = '';
        let maskUrl = '';

        if (tCtx) {
            // Draw Original Image
            tCtx.drawImage(bgImageRef.current, 0, 0);
            // Draw Annotations on top
            tCtx.drawImage(canvasRef.current, 0, 0);
            compositeUrl = tempCanvas.toDataURL('image/png');
        }

        // 2. MASK IMAGE (For AI Inpainting)
        maskUrl = generateMask(canvasRef.current);
        
        // 3. EXPORT
        onSave(compositeUrl, maskUrl);
        onClose();
    }
  };

  const handleClear = () => {
     const canvas = canvasRef.current;
     const ctx = canvas?.getContext('2d');
     if (canvas && ctx) {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         setNextLabelIndex(1);
         saveState(1);
     }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-panel z-10 shrink-0">
        <div className="flex items-center gap-2">
           <div className="p-2 bg-brand-500/20 rounded-lg">
             {activeTool === 'brush' && <Brush size={20} className="text-brand-500" />}
             {activeTool === 'eraser' && <Eraser size={20} className="text-brand-500" />}
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
               <MousePointer2 size={14} /> Markers
             </button>
             <button onClick={() => setActiveTool('brush')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'brush' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <Brush size={14} /> {t('editor.brush')}
             </button>
             <button onClick={() => setActiveTool('rect')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'rect' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <Square size={14} /> {t('editor.box')}
             </button>
             <button onClick={() => setActiveTool('eraser')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'eraser' ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
               <Eraser size={14} /> Eraser
             </button>
         </div>

         {/* Brush Settings */}
         {(activeTool === 'brush' || activeTool === 'rect' || activeTool === 'marker') && (
          <div className="flex items-center gap-4 border-l border-dark-border pl-6 animate-in slide-in-from-left-2 fade-in">
             {/* Color Picker */}
             <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase">{t('editor.color')}</label>
                <div className="flex gap-1">
                    {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ffffff', '#000000'].map(c => (
                        <button 
                            key={c}
                            onClick={() => setBrushColor(c)}
                            className={`w-5 h-5 rounded-full border border-white/20 transition-transform hover:scale-110 ${brushColor === c ? 'ring-2 ring-white scale-110' : ''}`}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>
                {/* Custom Color Input Hidden but accessible if needed */}
                <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="w-0 h-0 opacity-0" id="color-input"/>
                <label htmlFor="color-input" className="p-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer"><PaletteIcon /></label>
             </div>

             {activeTool === 'brush' && (
                 <>
                     <div className="w-px h-6 bg-dark-border" />
                     <div className="flex items-center gap-2">
                         <span className="text-xs font-bold text-gray-500 uppercase">{t('editor.size')}</span>
                         <input 
                            type="range" min="5" max="100" 
                            value={brushSize} 
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                            className="w-20 h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                         />
                     </div>
                 </>
             )}
          </div>
         )}
      </div>

      {/* Main Content Area */}
      <div 
        ref={containerRef}
        className="flex-1 bg-black/80 relative overflow-hidden flex items-center justify-center p-0 touch-none select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => { lastMouseEventRef.current = e; handleMouseMove(e); }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => { lastMouseEventRef.current = e; startDrawing(e); }}
        onTouchMove={(e) => { lastMouseEventRef.current = e; draw(e); }}
        onTouchEnd={stopDrawing}
        onWheel={handleWheel}
        style={{ cursor: isPanning ? 'grabbing' : activeTool === 'brush' || activeTool === 'eraser' ? 'crosshair' : activeTool === 'marker' ? MARKER_CURSOR : 'crosshair' }}
      >
         {/* Checkboard Pattern for Transparency */}
         <div className="absolute inset-0 pointer-events-none" 
              style={{ 
                  backgroundImage: 'linear-gradient(45deg, #222 25%, transparent 25%), linear-gradient(-45deg, #222 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #222 75%), linear-gradient(-45deg, transparent 75%, #222 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                  opacity: 0.3
              }} 
         />

         {/* Transforming Container */}
         <div 
            ref={contentRef}
            style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center', // We handle centering manually via flex/offset usually, but center origin is safer for zoom
                transition: isPanning || isDrawing ? 'none' : 'transform 0.1s ease-out',
                position: 'relative',
                boxShadow: '0 0 50px rgba(0,0,0,0.5)'
            }}
         >
             {/* 1. Base Image Layer */}
             <img 
                ref={bgImageRef}
                src={imageUrl} 
                alt="Original" 
                onLoad={handleImageLoad}
                className="pointer-events-none select-none"
                style={{ display: 'block', maxWidth: 'none' }} // Ensure native size
             />

             {/* 2. Drawing Layer */}
             <canvas 
                ref={canvasRef}
                className="absolute inset-0 pointer-events-none" // Events handled by container
                style={{ width: '100%', height: '100%' }}
             />
         </div>
         
         {/* Toast Hint */}
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
             {(activeTool === 'marker' || activeTool === 'rect') && (
                 <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-white border border-white/10">
                     {activeTool === 'marker' ? "Click objects to add numbered markers" : "Draw boxes to define numbered regions"}
                 </div>
             )}
             <div className="text-[10px] text-gray-500 bg-black/40 px-2 py-1 rounded">Scale: {Math.round(scale * 100)}%</div>
         </div>
      </div>
    </div>
  );
};

const PaletteIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>
);
