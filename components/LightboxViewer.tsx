
import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download, RefreshCcw, MessageSquarePlus, Brush, Trash2, ArrowRight } from 'lucide-react';
import { AssetItem } from '../types';

interface LightboxViewerProps {
  asset: AssetItem;
  onClose: () => void;
  onUseAsReference?: (asset: AssetItem) => void;
  onDiscuss?: (annotatedImage: string, cleanAsset: AssetItem) => void;
  onEdit?: (annotatedImage: string, cleanAsset: AssetItem) => void;
  onDelete?: () => void;
  onAddToChat?: (asset: AssetItem) => void;
  onInpaint?: (asset: AssetItem) => void; 
  onExtendVideo?: (imageData: string, mimeType: string) => void; // Updated Callback
}

export const LightboxViewer: React.FC<LightboxViewerProps> = ({ asset, onClose, onUseAsReference, onDelete, onAddToChat, onInpaint, onExtendVideo }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // --- Image View Mouse Handlers ---
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

  const handleInpaintClick = () => {
    if (onInpaint) {
        onInpaint(asset);
        onClose();
    }
  };

  const handleAddToChat = () => {
    if (onAddToChat) {
      onAddToChat(asset);
      onClose();
    }
  };

  const handleExtendClick = () => {
      if (asset.type === 'VIDEO' && onExtendVideo && videoRef.current) {
          try {
             const video = videoRef.current;
             const canvas = document.createElement('canvas');
             canvas.width = video.videoWidth;
             canvas.height = video.videoHeight;
             
             const ctx = canvas.getContext('2d');
             if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                // Get the frame as image data
                const frameData = canvas.toDataURL('image/jpeg', 0.95);
                const matches = frameData.match(/^data:(.+);base64,(.+)$/);
                if (matches) {
                   onExtendVideo(matches[2], matches[1]);
                   onClose();
                }
             }
          } catch (e) {
             console.error("Failed to capture video frame", e);
             alert("Could not capture video frame for extension. Security restrictions may apply.");
          }
      }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 z-50 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
      >
        <X size={24} />
      </button>
      
      <div className="flex flex-col max-w-6xl w-full h-full max-h-[90vh]">
        {/* Viewport */}
        <div 
           ref={containerRef}
           className="flex-1 flex items-center justify-center min-h-0 bg-dark-bg/50 rounded-2xl border border-dark-border overflow-hidden relative select-none"
        >
           {asset.type === 'IMAGE' ? (
             <div 
               className="relative flex items-center justify-center overflow-hidden"
               onMouseDown={handleMouseDown}
               onMouseMove={handleMouseMove}
               onMouseUp={handleMouseUp}
               onMouseLeave={handleMouseUp}
               style={{ 
                 cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                 width: '100%',
                 height: '100%'
               }}
             >
               <div
                 style={{
                   transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                   transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                   position: 'relative',
                   display: 'inline-block'
                 }}
               >
                 <img 
                    ref={imgRef}
                    src={asset.url} 
                    alt={asset.prompt} 
                    draggable={false}
                    className="max-w-full max-h-[80vh] object-contain"
                 />
               </div>
               
               {/* Controls Overlay */}
               <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full shadow-xl z-20">
                  <button onClick={handleZoomOut} disabled={scale <= 1} className="p-1.5 hover:bg-white/10 rounded-full disabled:opacity-30 text-white transition-colors">
                    <ZoomOut size={18} />
                  </button>
                  <span className="text-xs font-mono w-10 text-center text-white">{Math.round(scale * 100)}%</span>
                  <button onClick={handleZoomIn} disabled={scale >= 5} className="p-1.5 hover:bg-white/10 rounded-full disabled:opacity-30 text-white transition-colors">
                    <ZoomIn size={18} />
                  </button>
                  
                  <div className="w-px h-4 bg-white/20 mx-1" />
                  
                  {/* Edit Button moved here */}
                  {asset.type === 'IMAGE' && onInpaint && (
                    <button onClick={handleInpaintClick} className="p-1.5 hover:bg-white/10 rounded-full text-white transition-colors" title="Edit / Inpaint">
                      <Brush size={16} />
                    </button>
                  )}
                  
                  <button onClick={handleReset} className="p-1.5 hover:bg-white/10 rounded-full text-white transition-colors" title="Reset View">
                    <RotateCcw size={16} />
                  </button>
               </div>
             </div>
           ) : (
             <video 
               ref={videoRef}
               src={asset.url} 
               controls 
               autoPlay
               crossOrigin="anonymous"
               className="max-w-full max-h-full"
             />
           )}
        </div>
        
        {/* Metadata Panel */}
        <div className="mt-4 flex flex-col md:flex-row items-start justify-between bg-dark-panel p-4 md:p-6 rounded-2xl border border-dark-border gap-4 shrink-0">
           <div className="flex-1 min-w-0">
              <h3 className="text-xs text-brand-500 font-bold mb-1 uppercase tracking-wider">{asset.type} Generation</h3>
              <p className="text-white text-sm md:text-base leading-relaxed line-clamp-3 md:line-clamp-none overflow-y-auto max-h-24">
                {asset.prompt}
              </p>
           </div>
           
           <div className="flex flex-row md:flex-col gap-2 md:gap-1 text-right text-xs text-gray-500 shrink-0 border-t md:border-t-0 md:border-l border-dark-border pt-3 md:pt-0 md:pl-6 w-full md:w-auto justify-between md:justify-start">
              <div className="flex flex-col gap-1">
                <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                <span>{asset.metadata?.model}</span>
                <span className="font-medium text-gray-400">
                  {[asset.metadata?.resolution, asset.metadata?.aspectRatio].filter(Boolean).join(' • ')}
                </span>
              </div>

              <div className="flex gap-2 mt-2 justify-end items-center">
                 {/* Actions */}
                 {asset.type === 'IMAGE' && (
                   <>
                     {onUseAsReference && (
                       <button 
                         onClick={() => { onUseAsReference(asset); onClose(); }} 
                         className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-bold transition-colors"
                       >
                         <RefreshCcw size={14} /> Use as Ref
                       </button>
                     )}
                     
                     {onAddToChat && (
                       <button 
                         onClick={handleAddToChat} 
                         className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors"
                       >
                         <MessageSquarePlus size={14} /> Add to Chat
                       </button>
                     )}
                   </>
                 )}
                 
                 {/* Video Extension Button */}
                 {asset.type === 'VIDEO' && onExtendVideo && (
                    <button 
                      onClick={handleExtendClick}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors"
                      title="Use the current frame to continue this video"
                    >
                      <ArrowRight size={14} /> Continue
                    </button>
                 )}
                 
                 {onDelete && (
                   <button 
                     onClick={() => onDelete()} 
                     className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                     title="Delete"
                   >
                     <Trash2 size={16} />
                   </button>
                 )}
                 <a 
                   href={asset.url} 
                   download 
                   className="p-2 bg-white text-black hover:bg-gray-200 rounded-lg transition-colors flex items-center justify-center"
                   title="Download"
                 >
                   <Download size={16} />
                 </a>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};
