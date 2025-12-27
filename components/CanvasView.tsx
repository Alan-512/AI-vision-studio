
import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download, MessageSquarePlus, Brush, Trash2, Video, Wand2 } from 'lucide-react';
import { AssetItem, ImageModel, VideoModel } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface CanvasViewProps {
  asset: AssetItem;
  onClose: () => void; // "Back to Gallery"
  onAddToChat?: (asset: AssetItem) => void;
  onInpaint?: (asset: AssetItem) => void;
  // FIX: onExtendVideo now accepts videoUri (Veo API requires URI, not base64)
  onExtendVideo?: (videoUri: string) => void;
  onRemix?: (asset: AssetItem) => void;
  onDelete?: () => void;
}

export const CanvasView: React.FC<CanvasViewProps> = ({ asset, onClose, onDelete, onAddToChat, onInpaint, onExtendVideo, onRemix }) => {
  const { t } = useLanguage();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [asset.id]);

  const getModelLabel = (modelId: string | undefined) => {
    if (!modelId) return '';
    if (modelId === ImageModel.FLASH) return t('model.flash');
    if (modelId === ImageModel.PRO) return t('model.pro');
    if (modelId === VideoModel.VEO_FAST) return t('model.veo_fast');
    if (modelId === VideoModel.VEO_HQ) return t('model.veo_hq');
    return modelId;
  };

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

  // FIX: Use videoUri directly for video extension (Veo API requires URI)
  const handleExtendClick = () => {
    if (asset.type === 'VIDEO' && onExtendVideo && asset.videoUri) {
      onExtendVideo(asset.videoUri);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black relative animate-in fade-in duration-300 select-none">

      {/* Floating Close Button (Top Right) */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-50 p-2 bg-black/50 hover:bg-white/20 text-gray-400 hover:text-white rounded-full transition-colors backdrop-blur-sm"
        title="Close View"
      >
        <X size={24} />
      </button>

      {/* Main Viewport */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative flex items-center justify-center bg-dots-pattern"
        style={{
          backgroundImage: 'radial-gradient(#222 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: '#050505'
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
              <img
                src={asset.url}
                alt={asset.prompt}
                draggable={false}
                className="max-w-full max-h-full object-contain shadow-2xl shadow-black"
              />
            ) : (
              <video
                src={asset.url}
                controls
                className="max-w-full max-h-full shadow-2xl shadow-black"
                crossOrigin="anonymous"
              />
            )}
          </div>
        </div>

        {/* Floating Zoom Controls (Bottom Center of Image) */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full shadow-xl z-20">
          <button onClick={handleZoomOut} disabled={scale <= 1} className="p-1.5 hover:bg-white/10 rounded-full disabled:opacity-30 text-white transition-colors">
            <ZoomOut size={18} />
          </button>
          <span className="text-xs font-mono w-10 text-center text-white">{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} disabled={scale >= 5} className="p-1.5 hover:bg-white/10 rounded-full disabled:opacity-30 text-white transition-colors">
            <ZoomIn size={18} />
          </button>

          <div className="w-px h-4 bg-white/20 mx-1" />

          {asset.type === 'IMAGE' && onInpaint && (
            <button onClick={() => onInpaint(asset)} className="p-1.5 hover:bg-white/10 rounded-full text-white transition-colors" title="Edit / Inpaint">
              <Brush size={16} />
            </button>
          )}

          <button onClick={handleReset} className="p-1.5 hover:bg-white/10 rounded-full text-white transition-colors" title="Reset View">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Bottom Details Panel */}
      <div className="shrink-0 bg-dark-panel border-t border-dark-border p-6 flex flex-col md:flex-row gap-6 z-40 shadow-[0_-5px_30px_rgba(0,0,0,0.5)] select-auto">
        {/* Left: Prompt & Info */}
        <div className="flex-1 min-w-0">
          <div className="text-brand-500 font-bold text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2">
            {asset.type} GENERATION
          </div>
          <p
            className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar"
            style={{ userSelect: 'text', cursor: 'text' }}
          >
            {asset.prompt}
          </p>
        </div>

        {/* Right: Metadata & Actions */}
        <div className="flex flex-col items-end justify-between gap-4 shrink-0">
          <div className="text-right text-xs text-gray-500 space-y-0.5">
            <div>{new Date(asset.createdAt).toLocaleDateString()}</div>
            <div className="text-gray-300 font-bold">{getModelLabel(asset.metadata?.model)}</div>
            <div className="font-mono text-gray-400">
              {[asset.metadata?.resolution, asset.metadata?.aspectRatio].filter(Boolean).join(' • ')}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Remix Action */}
            {asset.type === 'IMAGE' && onRemix && (
              <button
                onClick={() => onRemix(asset)}
                className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors shadow-lg shadow-purple-900/20"
              >
                <Wand2 size={14} /> {t('btn.remix')}
              </button>
            )}

            {/* Add to Chat Action */}
            {asset.type === 'IMAGE' && onAddToChat && (
              <button
                onClick={() => onAddToChat(asset)}
                className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors shadow-lg shadow-indigo-900/20"
              >
                <MessageSquarePlus size={14} /> {t('chat.placeholder').replace('...', '')}
              </button>
            )}

            {/* Video Extend Action - only show if videoUri is available */}
            {asset.type === 'VIDEO' && onExtendVideo && asset.videoUri && (
              <button
                onClick={handleExtendClick}
                className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors"
              >
                <Video size={14} />
                {t('btn.extend')}
              </button>
            )}

            <div className="w-px h-6 bg-dark-border mx-1" />

            {/* Secondary Actions */}
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-2 hover:bg-red-500/10 text-gray-500 hover:text-red-400 rounded-lg transition-colors"
                title={t('btn.delete')}
              >
                <Trash2 size={18} />
              </button>
            )}

            <button
              onClick={handleDownload}
              className="p-2 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors"
              title={t('btn.download')}
            >
              <Download size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
