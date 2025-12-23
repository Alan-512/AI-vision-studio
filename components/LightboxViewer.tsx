
import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Download, MessageSquarePlus, Brush, Trash2, Video, Wand2 } from 'lucide-react';
import { AssetItem, ImageModel, VideoModel } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface LightboxViewerProps {
  asset: AssetItem;
  onClose: () => void;
  onUseAsReference?: (asset: AssetItem) => void;
  onDiscuss?: (annotatedImage: string, cleanAsset: AssetItem) => void;
  onEdit?: (annotatedImage: string, cleanAsset: AssetItem) => void;
  onDelete?: () => void;
  onAddToChat?: (asset: AssetItem) => void;
  onInpaint?: (asset: AssetItem) => void;
  onExtendVideo?: (videoData: string, mimeType: string) => void;
  onRemix?: (asset: AssetItem) => void; // New Remix Callback
}

export const LightboxViewer: React.FC<LightboxViewerProps> = ({ asset, onClose, onDelete, onAddToChat, onInpaint, onExtendVideo, onRemix }) => {
  const { t } = useLanguage();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isPreparingExtension, setIsPreparingExtension] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
            onClose();
          } else {
            if (base64data.startsWith('data:video')) {
              const parts = base64data.split(',');
              const mime = parts[0].match(/:(.*?);/)?.[1] || 'video/mp4';
              onExtendVideo(parts[1], mime);
              onClose();
            } else {
              throw new Error("Failed to parse base64 video");
            }
          }
          setIsPreparingExtension(false);
        };
        reader.readAsDataURL(blob);

      } catch (e) {
        console.error("Failed to prepare video for extension", e);
        alert("Could not load video data for extension.");
        setIsPreparingExtension(false);
      }
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    if (asset.type === 'IMAGE') {
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
        const link = document.createElement('a');
        link.href = asset.url;
        link.download = `lumina-image-${asset.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } else {
      const link = document.createElement('a');
      link.href = asset.url;
      link.download = `lumina-video-${asset.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
          className="flex-1 flex items-center justify-center min-h-0 bg-dark-bg/50 rounded-2xl border border-dark-border overflow-hidden relative select-none w-full"
        >
          {asset.type === 'IMAGE' ? (
            <div
              className="relative flex items-center justify-center overflow-hidden w-full h-full"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              }}
            >
              <div
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%'
                }}
              >
                <img
                  ref={imgRef}
                  src={asset.url}
                  alt={asset.prompt}
                  draggable={false}
                  className="max-w-full max-h-full object-contain"
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
        <div className="mt-4 flex flex-col md:flex-row items-start justify-between bg-dark-panel p-4 md:p-6 rounded-2xl border border-dark-border gap-4 shrink-0 select-auto">
          <div className="flex-1 min-w-0">
            <h3 className="text-xs text-brand-500 font-bold mb-1 uppercase tracking-wider">{asset.type} Generation</h3>
            <p
              className="text-white text-sm md:text-base leading-relaxed overflow-y-auto max-h-36 pr-2 custom-scrollbar whitespace-pre-wrap break-words"
              style={{ userSelect: 'text', cursor: 'text' }}
            >
              {asset.prompt}
            </p>
          </div>

          <div className="flex flex-col gap-2 md:gap-1 text-right text-xs text-gray-500 shrink-0 border-t md:border-t-0 md:border-l border-dark-border pt-3 md:pt-0 md:pl-6 w-full md:w-auto">
            <div className="flex flex-col gap-1">
              <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
              <span className="text-gray-300 font-bold">{getModelLabel(asset.metadata?.model)}</span>
              <span className="font-medium text-gray-400">
                {[
                  asset.metadata?.resolution,
                  asset.metadata?.aspectRatio
                ].filter(Boolean).join(' • ')}
              </span>
            </div>

            <div className="flex gap-2 mt-2 justify-end items-center">
              {/* Actions */}
              {asset.type === 'IMAGE' && (
                <>
                  {/* Remix Button */}
                  {onRemix && (
                    <button
                      onClick={() => { onRemix(asset); onClose(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors"
                    >
                      <Wand2 size={14} /> {t('btn.remix')}
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
                  disabled={isPreparingExtension}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                  title="Generate next 5 seconds for this video"
                >
                  {isPreparingExtension ? <div className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" /> : <Video size={14} />}
                  {t('btn.extend')}
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
              <button
                onClick={handleDownload}
                className="p-2 bg-white text-black hover:bg-gray-200 rounded-lg transition-colors flex items-center justify-center"
                title="Download"
              >
                <Download size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
