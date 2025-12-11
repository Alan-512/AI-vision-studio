
import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download, MessageSquarePlus, Brush, Trash2, Video, Wand2, ChevronLeft, Maximize2 } from 'lucide-react';
import { AssetItem } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface CanvasViewProps {
  asset: AssetItem;
  onClose: () => void; // "Back to Gallery"
  onAddToChat?: (asset: AssetItem) => void;
  onInpaint?: (asset: AssetItem) => void; 
  onExtendVideo?: (videoData: string, mimeType: string) => void;
  onRemix?: (asset: AssetItem) => void;
  onDelete?: () => void;
}

export const CanvasView: React.FC<CanvasViewProps> = ({ asset, onClose, onDelete, onAddToChat, onInpaint, onExtendVideo, onRemix }) => {
  const { t } = useLanguage();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isPreparingExtension, setIsPreparingExtension] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [asset.id]);

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.5, 5));
  const handleZoomOut = () => {
    setScale(prev => {
      const newScale = Math.max(prev - 0.5, 1);
      if (newScale === 1) setPosition({ x: 0, y: 0 });
      return newScale;
    });
  };
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale === 1 || asset.type !== 'IMAGE') return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    const link = document.createElement('a');
    link.href = asset.url;
    link.download = `lumina-${asset.type.toLowerCase()}-${asset.id}.${asset.type === 'IMAGE' ? 'png' : 'mp4'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExtendClick = async () => {
    if (asset.type === 'VIDEO' && onExtendVideo && asset.url) {
        setIsPreparingExtension(true);
        try {
           const response = await fetch(asset.url);
           const blob = await response.blob();
           const reader = new FileReader();
           reader.onloadend = () => {
               const base64data = reader.result as string;
               const matches = base64data.match(/^data:(.+);base64,(.+)$/);
               if (matches) {
                   onExtendVideo(matches[2], matches[1]); 
               }
               setIsPreparingExtension(false);
           };
           reader.readAsDataURL(blob);
        } catch (e) {
           console.error("Extension prep failed", e);
           setIsPreparingExtension(false);
        }
    }
  };

  return (
    <div className="flex flex-col h-full bg-dark-bg animate-in fade-in duration-300">
      {/* Canvas Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-dark-border bg-dark-panel shrink-0">
        <div className="flex items-center gap-3">
           <button 
             onClick={onClose}
             className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
           >
              <ChevronLeft size={18} />
              <span className="text-xs font-bold uppercase tracking-wider">{t('nav.projects')} / {t('header.assets')}</span>
           </button>
           <div className="h-4 w-px bg-white/10" />
           <span className="text-sm font-medium text-gray-200 truncate max-w-[200px]">{asset.prompt}</span>
        </div>

        <div className="flex items-center gap-2">
           <div className="flex items-center bg-black/30 rounded-lg p-1 mr-2 border border-white/5">
              <button onClick={handleZoomOut} disabled={scale <= 1} className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 text-gray-300 transition-colors"><ZoomOut size={16}/></button>
              <span className="text-xs font-mono w-10 text-center text-gray-500">{Math.round(scale * 100)}%</span>
              <button onClick={handleZoomIn} disabled={scale >= 5} className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-30 text-gray-300 transition-colors"><ZoomIn size={16}/></button>
              <button onClick={handleReset} className="p-1.5 hover:bg-white/10 rounded-md text-gray-300 transition-colors"><RotateCcw size={16}/></button>
           </div>
           
           {onDelete && (
             <button onClick={onDelete} className="p-2 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition-colors"><Trash2 size={18}/></button>
           )}
           <button onClick={handleDownload} className="p-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg shadow-lg transition-colors"><Download size={18}/></button>
        </div>
      </div>

      {/* Viewport */}
      <div 
        ref={containerRef} 
        className="flex-1 overflow-hidden relative bg-dots-pattern"
        style={{
             backgroundImage: 'radial-gradient(#333 1px, transparent 1px)',
             backgroundSize: '24px 24px',
             backgroundColor: '#0f0f11'
        }}
      >
         <div 
            className="w-full h-full flex items-center justify-center"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
         >
            <div 
               style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', height: '100%'
               }}
            >
               {asset.type === 'IMAGE' ? (
                  <img src={asset.url} alt={asset.prompt} draggable={false} className="max-w-[90%] max-h-[90%] object-contain shadow-2xl shadow-black/50" />
               ) : (
                  <video src={asset.url} controls className="max-w-[90%] max-h-[90%] shadow-2xl shadow-black/50" crossOrigin="anonymous" />
               )}
            </div>
         </div>

         {/* Floating Action Bar (Bottom) */}
         <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 bg-dark-panel/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl z-20 animate-in slide-in-from-bottom-10">
             {asset.type === 'IMAGE' && (
               <>
                  {onRemix && (
                    <button onClick={() => onRemix(asset)} className="flex items-col gap-2 px-3 py-2 hover:bg-white/5 rounded-xl text-gray-300 hover:text-white transition-colors flex-col items-center min-w-[60px]">
                       <Wand2 size={20} className="text-purple-400" />
                       <span className="text-[10px] font-medium mt-1">Remix</span>
                    </button>
                  )}
                  {onInpaint && (
                    <button onClick={() => onInpaint(asset)} className="flex items-col gap-2 px-3 py-2 hover:bg-white/5 rounded-xl text-gray-300 hover:text-white transition-colors flex-col items-center min-w-[60px]">
                       <Brush size={20} className="text-blue-400" />
                       <span className="text-[10px] font-medium mt-1">Edit</span>
                    </button>
                  )}
                  {onAddToChat && (
                    <button onClick={() => onAddToChat(asset)} className="flex items-col gap-2 px-3 py-2 hover:bg-white/5 rounded-xl text-gray-300 hover:text-white transition-colors flex-col items-center min-w-[60px]">
                       <MessageSquarePlus size={20} className="text-green-400" />
                       <span className="text-[10px] font-medium mt-1">Chat</span>
                    </button>
                  )}
               </>
             )}
             
             {asset.type === 'VIDEO' && onExtendVideo && (
                <button 
                  onClick={handleExtendClick} 
                  disabled={isPreparingExtension}
                  className="flex items-col gap-2 px-3 py-2 hover:bg-white/5 rounded-xl text-gray-300 hover:text-white transition-colors flex-col items-center min-w-[60px] disabled:opacity-50"
                >
                   {isPreparingExtension ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <Video size={20} className="text-purple-400" />}
                   <span className="text-[10px] font-medium mt-1">Extend</span>
                </button>
             )}
         </div>
      </div>
    </div>
  );
};
