import React, { useRef, useState, useEffect } from 'react';
import { Save, Undo, Brush, RotateCcw, Square } from 'lucide-react';

interface CanvasEditorProps {
  imageUrl: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

type ToolType = 'brush' | 'rect';

interface HistoryItem {
  imageData: ImageData;
  labelIndex: number;
}

// Custom Brush Cursor (Red/White SVG)
const BRUSH_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" stroke="%23ef4444" fill="%23ef4444"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2.5 2.24 0 .46.62.8 1 .8 2.48 0 4.5-2.01 4.5-4.5 0-.77.5-1.56 1-1.56Z" fill="%23ef4444"/></svg>') 0 24, auto`;

export const CanvasEditor: React.FC<CanvasEditorProps> = ({ imageUrl, onSave, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Tools
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [brushSize, setBrushSize] = useState(10); // Default size reduced to 10
  
  // State
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [nextLabelIndex, setNextLabelIndex] = useState(1);
  
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

    // Fit canvas to container while maintaining aspect ratio
    const container = containerRef.current;
    const maxWidth = container.clientWidth - 40;
    const maxHeight = container.clientHeight - 40;
    
    let width = img.naturalWidth;
    let height = img.naturalHeight;

    const scale = Math.min(maxWidth / width, maxHeight / height);
    width *= scale;
    height *= scale;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, width, height);
      setNextLabelIndex(1);
      saveState(1); // Save initial state with index 1
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

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
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

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); 
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;

    if (ctx && canvas) {
      if (activeTool === 'brush') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red brush
      } else if (activeTool === 'rect') {
         dragStartRef.current = { x, y };
         snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    
    if (ctx) {
      if (activeTool === 'brush') {
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (activeTool === 'rect' && dragStartRef.current && snapshotRef.current) {
         // Restore original state to avoid trails
         ctx.putImageData(snapshotRef.current, 0, 0);
         
         const startX = dragStartRef.current.x;
         const startY = dragStartRef.current.y;
         const width = x - startX;
         const height = y - startY;

         // Draw Box Body
         ctx.fillStyle = 'rgba(255, 0, 0, 0.15)'; // Light red fill
         ctx.strokeStyle = '#ef4444'; // Red Border
         ctx.lineWidth = 2;
         ctx.fillRect(startX, startY, width, height);
         ctx.strokeRect(startX, startY, width, height);

         // Draw Label Badge (Top-Left)
         // Calculate top-left regardless of drag direction
         const topLeftX = width > 0 ? startX : x;
         const topLeftY = height > 0 ? startY : y;
         
         const badgeSize = 18;
         ctx.fillStyle = '#ef4444'; // Solid red bg for label
         ctx.fillRect(topLeftX, topLeftY - badgeSize/2, badgeSize, badgeSize);
         
         // Draw Number
         ctx.fillStyle = 'white';
         ctx.font = 'bold 10px sans-serif';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText(nextLabelIndex.toString(), topLeftX + badgeSize/2, topLeftY - badgeSize/2 + badgeSize/2);
      }
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const ctx = canvasRef.current?.getContext('2d');
      let newLabelIndex = nextLabelIndex;

      if (activeTool === 'brush') {
         ctx?.closePath();
      } else if (activeTool === 'rect') {
         // Increment the label index for the next box
         newLabelIndex = nextLabelIndex + 1;
         setNextLabelIndex(newLabelIndex);
      }
      
      dragStartRef.current = null;
      snapshotRef.current = null;
      saveState(newLabelIndex);
    }
  };

  const handleSave = () => {
    if (canvasRef.current) {
      // Export the full composed image (Original + Red Mask/Box)
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
             {activeTool === 'brush' ? <Brush size={20} className="text-brand-500" /> : <Square size={20} className="text-brand-500" />}
           </div>
           <div>
             <h2 className="text-lg font-bold text-white">Editor & Inpainting</h2>
             <p className="text-xs text-gray-400">Draw masks or boxes to guide the AI</p>
           </div>
        </div>
        
        <div className="flex items-center gap-3">
           <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
             Cancel
           </button>
           <button 
             onClick={handleSave}
             className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all"
           >
             <Save size={16} />
             Use Image
           </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="h-14 border-b border-dark-border bg-dark-surface flex items-center justify-center gap-6 shrink-0">
         
         {/* Undo/Reset Group */}
         <div className="flex items-center gap-2 border-r border-dark-border pr-6">
            <button 
              onClick={handleUndo} 
              disabled={history.length <= 1}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              title="Undo"
            >
               <Undo size={18} />
            </button>
            <button 
              onClick={handleClear} 
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Reset All"
            >
               <RotateCcw size={18} />
            </button>
         </div>

         {/* Tools Group */}
         <div className="flex items-center gap-2 p-1 bg-black/20 rounded-lg border border-white/5">
             <button
               onClick={() => setActiveTool('brush')}
               className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                 activeTool === 'brush' 
                   ? 'bg-brand-600 text-white shadow-lg' 
                   : 'text-gray-400 hover:text-white hover:bg-white/5'
               }`}
             >
               <Brush size={14} /> Brush
             </button>
             <button
               onClick={() => setActiveTool('rect')}
               className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                 activeTool === 'rect' 
                   ? 'bg-brand-600 text-white shadow-lg' 
                   : 'text-gray-400 hover:text-white hover:bg-white/5'
               }`}
             >
               <Square size={14} /> Box
             </button>
         </div>

         {/* Settings Group */}
         {activeTool === 'brush' && (
            <div className="flex items-center gap-3 border-l border-dark-border pl-6 animate-in slide-in-from-left-2 fade-in">
                <span className="text-xs font-bold text-gray-500 uppercase">Size</span>
                <input 
                  type="range" 
                  min="5" 
                  max="50" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-24 accent-brand-500"
                />
                <div 
                  className="rounded-full bg-red-500/50 border border-white/20 transition-all" 
                  style={{ width: brushSize/2, height: brushSize/2 }} 
                />
            </div>
         )}
      </div>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 bg-dark-bg/50 relative overflow-hidden flex items-center justify-center p-8 touch-none`}
        style={{ cursor: activeTool === 'brush' ? BRUSH_CURSOR : 'crosshair' }}
      >
         <canvas 
           ref={canvasRef}
           onMouseDown={startDrawing}
           onMouseMove={draw}
           onMouseUp={stopDrawing}
           onMouseLeave={stopDrawing}
           onTouchStart={startDrawing}
           onTouchMove={draw}
           onTouchEnd={stopDrawing}
           className="shadow-2xl shadow-black border border-dark-border/50"
         />
      </div>
    </div>
  );
};