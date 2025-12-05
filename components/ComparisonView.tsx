
import React, { useState, useEffect, useRef } from 'react';
import { X, MoveHorizontal, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { AssetItem } from '../types';

interface ComparisonViewProps {
  assetA: AssetItem;
  assetB: AssetItem;
  onClose: () => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ assetA, assetB, onClose }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Handle slider drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Stop pan from starting
    e.preventDefault();
    
    // Only trigger slider drag if clicking the handle line
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isResizing && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = (x / rect.width) * 100;
      setSliderPosition(percent);
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Pan & Zoom
  const handlePanStart = (e: React.MouseEvent) => {
    if (isResizing) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handlePanEnd = () => setIsPanning(false);

  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setSliderPosition(50);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-panel z-10">
        <div className="flex items-center gap-4">
           <h2 className="text-lg font-bold text-white flex items-center gap-2">
             <MoveHorizontal size={20} className="text-brand-500" />
             Comparison View
           </h2>
           <div className="flex gap-4 text-sm text-gray-400">
             <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-brand-500"></span>
                <span className="truncate max-w-[200px]">{assetA.prompt}</span>
             </div>
             <span className="text-gray-600">vs</span>
             <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-gray-500"></span>
                <span className="truncate max-w-[200px]">{assetB.prompt}</span>
             </div>
           </div>
        </div>
        
        <div className="flex items-center gap-2">
           <button onClick={() => setScale(s => Math.max(0.5, s - 0.5))} className="p-2 hover:bg-white/10 rounded-full text-white"><ZoomOut size={18}/></button>
           <span className="text-xs font-mono w-12 text-center text-gray-400">{Math.round(scale * 100)}%</span>
           <button onClick={() => setScale(s => Math.min(4, s + 0.5))} className="p-2 hover:bg-white/10 rounded-full text-white"><ZoomIn size={18}/></button>
           <button onClick={resetView} className="p-2 hover:bg-white/10 rounded-full text-white"><RotateCcw size={18}/></button>
           <div className="w-px h-6 bg-dark-border mx-2" />
           <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white"><X size={20}/></button>
        </div>
      </div>

      {/* Viewer */}
      <div 
        className="flex-1 relative overflow-hidden flex items-center justify-center bg-dark-bg select-none"
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
      >
        <div 
           ref={containerRef}
           className="relative shadow-2xl shadow-black bg-black/20"
           style={{
             width: '80vw',
             height: '80vh',
             cursor: isResizing ? 'col-resize' : (isPanning ? 'grabbing' : 'grab')
           }}
        >
           {/* Layer Bottom: Image B (Full View) */}
           <div className="absolute inset-0 overflow-hidden flex items-center justify-center pointer-events-none">
               <div 
                 className="w-full h-full flex items-center justify-center"
                 style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transition: isPanning ? 'none' : 'transform 0.2s ease-out'
                 }}
               >
                  <img 
                    src={assetB.url} 
                    alt="B" 
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
               </div>
               <div className="absolute bottom-4 right-4 bg-black/60 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-md">
                    B
               </div>
           </div>

           {/* Layer Top: Image A (Clipped by Slider) */}
           {/* We clip the CONTAINER, not the image, so the split stays fixed to the viewport */}
           <div 
             className="absolute inset-0 overflow-hidden flex items-center justify-center pointer-events-none border-r border-white/20"
             style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
           >
               <div 
                 className="w-full h-full flex items-center justify-center"
                 style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transition: isPanning ? 'none' : 'transform 0.2s ease-out'
                 }}
               >
                  <img 
                    src={assetA.url} 
                    alt="A" 
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
               </div>
               <div className="absolute bottom-4 left-4 bg-brand-600/90 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-md">
                    A
               </div>
           </div>

           {/* Slider Handle */}
           <div 
             className="absolute top-0 bottom-0 w-8 -ml-4 cursor-col-resize z-20 flex justify-center group"
             style={{ left: `${sliderPosition}%` }}
             onMouseDown={handleMouseDown}
           >
              {/* Visible Line */}
              <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] group-hover:shadow-[0_0_15px_rgba(255,255,255,0.5)] transition-shadow" />
              
              {/* Center Handle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-brand-600 border-2 border-brand-100">
                 <MoveHorizontal size={16} />
              </div>
           </div>

        </div>
      </div>
    </div>
  );
};
