
import React from 'react';
import { AssetItem } from '../types';
import { Download, ZoomIn, RefreshCcw, Trash2, MessageSquarePlus, Star, Check, RotateCcw, X, Loader2, AlertCircle } from 'lucide-react';

interface AssetCardProps {
  asset: AssetItem;
  onClick: (asset: AssetItem) => void;
  onUseAsReference?: (asset: AssetItem) => void;
  onDelete?: () => void;
  onAddToChat?: (asset: AssetItem) => void;
  onToggleFavorite?: (asset: AssetItem) => void;
  
  // Selection Props
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (asset: AssetItem) => void;
  
  // Trash Props
  isTrashMode?: boolean;
  onRestore?: () => void;
}

export const AssetCard: React.FC<AssetCardProps> = ({ 
  asset, 
  onClick, 
  onUseAsReference, 
  onDelete, 
  onAddToChat, 
  onToggleFavorite,
  isSelectionMode,
  isSelected,
  onToggleSelection,
  isTrashMode,
  onRestore
}) => {
  const isGenerating = asset.status === 'GENERATING' || asset.status === 'PENDING';
  const isFailed = asset.status === 'FAILED';

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isFailed) return;

    if (asset.type === 'IMAGE') {
      // Force convert to PNG via Canvas
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = asset.url;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `lumina-image-${asset.id}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }
          }, 'image/png');
        }
      };
      img.onerror = () => {
        // Fallback if canvas fails
        const link = document.createElement('a');
        link.href = asset.url;
        link.download = `lumina-image-${asset.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
    } else {
      // Video
      const link = document.createElement('a');
      link.href = asset.url;
      link.download = `lumina-video-${asset.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleUseRef = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onUseAsReference) {
      onUseAsReference(asset);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onDelete) {
      onDelete();
    }
  };
  
  const handleAddToChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onAddToChat) {
      onAddToChat(asset);
    }
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleFavorite) {
      onToggleFavorite(asset);
    }
  };

  const handleRestore = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onRestore) {
      onRestore();
    }
  };

  const handleClick = () => {
     if (isGenerating || isFailed) return; 
     if (isSelectionMode && onToggleSelection && !isTrashMode) {
        onToggleSelection(asset);
     } else {
        onClick(asset);
     }
  };

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent) => {
    if (asset.type !== 'IMAGE' || isGenerating || isFailed) return;
    
    // Set data for internal app drag
    e.dataTransfer.setData('application/lumina-asset', JSON.stringify(asset));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Set drag image (optional, browser default is usually fine)
    e.dataTransfer.setData('text/plain', asset.prompt);
  };

  return (
    <div 
      className={`group relative bg-dark-surface rounded-xl overflow-hidden border transition-all duration-300 shadow-lg aspect-square 
        ${isSelected 
          ? 'border-brand-500 ring-2 ring-brand-500/50 scale-95' 
          : 'border-transparent hover:border-brand-500 hover:shadow-xl hover:-translate-y-1'
        }
        ${asset.isFavorite && !isSelected && !isTrashMode ? 'border-yellow-500/50' : ''}
        ${isTrashMode ? 'opacity-80 hover:opacity-100 grayscale-[0.3] hover:grayscale-0' : ''}
        ${isGenerating ? 'cursor-wait border-brand-500/50' : 'cursor-pointer'}
        ${isFailed ? 'border-red-500/30 cursor-not-allowed' : ''}
      `}
      onClick={handleClick}
      draggable={!isTrashMode && asset.type === 'IMAGE' && !isGenerating && !isFailed}
      onDragStart={handleDragStart}
    >
      {isGenerating ? (
         <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 p-4 text-center space-y-3">
             <div className="relative">
                <div className="w-10 h-10 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="w-2 h-2 bg-brand-400 rounded-full animate-pulse" />
                </div>
             </div>
             <div>
                <p className="text-xs font-bold text-white">Generating...</p>
                <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{asset.prompt}</p>
             </div>
         </div>
      ) : isFailed ? (
         <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/10 p-4 text-center space-y-2">
             <AlertCircle size={32} className="text-red-500/50" />
             <p className="text-xs font-bold text-red-400">Generation Failed</p>
             <p className="text-[10px] text-gray-500 line-clamp-2">{asset.prompt}</p>
             {onDelete && (
                <button 
                   onClick={handleDelete}
                   className="mt-2 px-3 py-1 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded text-[10px] font-bold transition-colors"
                >
                   Remove
                </button>
             )}
         </div>
      ) : (
         <>
           {asset.type === 'IMAGE' ? (
             <img 
               src={asset.url} 
               alt={asset.prompt} 
               className="w-full h-full object-cover"
               loading="lazy"
             />
           ) : (
             <video 
               src={asset.url} 
               className="w-full h-full object-cover"
               muted
               loop
               onMouseOver={e => e.currentTarget.play()}
               onMouseOut={e => e.currentTarget.pause()}
             />
           )}
         </>
      )}
      
      {/* Selection Overlay (Always visible when selected) */}
      {(isSelectionMode || isSelected) && !isTrashMode && !isGenerating && !isFailed && (
         <div className={`absolute inset-0 bg-black/20 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-brand-500 border-brand-500' : 'bg-black/40 border-white/50'}`}>
               {isSelected && <Check size={14} className="text-white" />}
            </div>
         </div>
      )}

      {/* Action Overlay (Hidden in Selection Mode) */}
      {!isSelectionMode && !isGenerating && !isFailed && (
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 z-10">
          <p className="text-xs text-white line-clamp-2 mb-2 font-medium pointer-events-none">{asset.prompt}</p>
          <div className="flex gap-2 justify-end z-20 flex-wrap">
            {isTrashMode ? (
              // Trash Mode Actions
              <>
                 <button 
                  type="button"
                  onClick={handleRestore}
                  className="p-1.5 bg-green-500/80 hover:bg-green-600 rounded-lg text-white backdrop-blur-md transition-colors"
                  title="Restore"
                 >
                   <RotateCcw size={16} />
                 </button>
                 <button 
                  type="button"
                  onClick={handleDelete}
                  className="p-1.5 bg-red-500/80 hover:bg-red-600 rounded-lg text-white backdrop-blur-md transition-colors"
                  title="Delete Permanently"
                 >
                   <X size={16} />
                 </button>
              </>
            ) : (
              // Standard Actions
              <>
                {onToggleFavorite && (
                  <button 
                    type="button"
                    onClick={handleFavorite}
                    className={`p-1.5 rounded-lg backdrop-blur-md transition-colors ${asset.isFavorite ? 'bg-yellow-500 text-white' : 'bg-white/10 text-white hover:bg-yellow-500/50'}`}
                    title={asset.isFavorite ? "Unfavorite" : "Favorite"}
                  >
                    <Star size={16} fill={asset.isFavorite ? "currentColor" : "none"} />
                  </button>
                )}
                {onDelete && (
                  <button 
                    type="button"
                    onClick={handleDelete}
                    className="p-1.5 bg-red-500/80 hover:bg-red-600 rounded-lg text-white backdrop-blur-md transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {asset.type === 'IMAGE' && onAddToChat && (
                  <button 
                    type="button"
                    onClick={handleAddToChat}
                    className="p-1.5 bg-indigo-500/80 hover:bg-indigo-500 rounded-lg text-white backdrop-blur-md transition-colors"
                    title="Add to Assistant"
                  >
                    <MessageSquarePlus size={16} />
                  </button>
                )}
                {asset.type === 'IMAGE' && onUseAsReference && (
                  <button 
                    type="button"
                    onClick={handleUseRef}
                    className="p-1.5 bg-brand-500/80 hover:bg-brand-500 rounded-lg text-white backdrop-blur-md transition-colors"
                    title="Use as Reference Image"
                  >
                    <RefreshCcw size={16} />
                  </button>
                )}
                <button 
                  type="button"
                  onClick={handleDownload}
                  className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white backdrop-blur-md transition-colors"
                  title="Download"
                >
                  <Download size={16} />
                </button>
              </>
            )}
            
            {/* Inspect is always available */}
            <button 
              type="button"
              className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white backdrop-blur-md transition-colors"
              title="Inspect"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
      )}
      
      {/* Badges */}
      <div className="absolute top-2 left-2 flex gap-1 pointer-events-none">
        <div className={`px-2 py-0.5 backdrop-blur-sm rounded text-[10px] font-bold text-white uppercase tracking-wider ${isFailed ? 'bg-red-500/80' : 'bg-black/50'}`}>
          {isFailed ? 'FAILED' : asset.type}
        </div>
        {asset.isFavorite && !isTrashMode && !isGenerating && !isFailed && (
          <div className="p-0.5 bg-yellow-500 text-white rounded-full shadow-lg">
             <Star size={10} fill="currentColor" />
          </div>
        )}
      </div>
    </div>
  );
};
