
import React, { useEffect, useRef, useState } from 'react';
import { Undo, Brush, Eraser, Square, MousePointer2, ArrowUpRight, Type, Settings, MessageCircle, Forward, Sparkles, ChevronDown } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { AspectRatio, ImageModel, ImageResolution } from '../types';

interface CanvasEditRegionExport {
  id: string;
  color: string;
  instruction: string;
  maskDataUrl: string;
}

interface CanvasEditorExportPayload {
  baseImageDataUrl: string;
  previewDataUrl: string;
  mergedMaskDataUrl: string;
  regions: CanvasEditRegionExport[];
}

interface DirectGenerateOptions {
  imageModel: ImageModel;
  aspectRatio: AspectRatio;
  imageResolution: ImageResolution;
}

interface CanvasEditorProps {
  imageUrl: string;
  onSaveToConfig: (payload: CanvasEditorExportPayload) => void;
  onSaveToChat: (payload: CanvasEditorExportPayload) => void;
  onClose: () => void;
  // New: Direct generation from editor
  onDirectGenerate?: (payload: CanvasEditorExportPayload, options: DirectGenerateOptions) => void;
  originalMetadata?: {
    model?: string;
    aspectRatio?: string;
    resolution?: string;
  };
}

type ToolType = 'brush' | 'rect' | 'marker' | 'eraser' | 'arrow' | 'text';

interface RegionState {
  id: string;
  color: string;
  instruction: string;
  markerPosition?: { x: number; y: number };
  rectLabelPosition?: { x: number; y: number };
}

interface RegionSnapshot {
  id: string;
  imageData: ImageData;
}

interface RegionCreationResult {
  region: RegionState;
  regions: RegionState[];
  nextLabelIndex: number;
}

interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  width: number;
  height: number;
  regionId?: string;
  instructionText?: string;
}

interface ArrowAnnotation {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  lineWidth: number;
  headLength: number;
}

interface TextEntryState {
  id?: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  value: string;
  width: number;
  height: number;
  fontSize: number;
  color: string;
}

interface HistoryItem {
  regions: RegionState[];
  regionSnapshots: RegionSnapshot[];
  textAnnotations: TextAnnotation[];
  arrowAnnotations: ArrowAnnotation[];
  activeRegionId: string | null;
  labelIndex: number;
}

const MARKER_CURSOR = `crosshair`;
const TEXT_BOX_PADDING = 3;
const TEXT_LINE_HEIGHT = 1.1;

// Resolution options based on model
// Resolution options based on model
const RESOLUTION_OPTIONS: Record<string, ImageResolution[]> = {
  [ImageModel.FLASH]: [ImageResolution.RES_1K],
  [ImageModel.PRO]: [ImageResolution.RES_1K, ImageResolution.RES_2K, ImageResolution.RES_4K]
};

export const CanvasEditor: React.FC<CanvasEditorProps> = ({
  imageUrl,
  onSaveToConfig,
  onSaveToChat,
  onClose,
  onDirectGenerate,
  originalMetadata
}) => {
  const { t } = useLanguage();

  // Dropdown states
  const [showAddToMenu, setShowAddToMenu] = useState(false);
  const [showGeneratePanel, setShowGeneratePanel] = useState(false);

  // Generation options (default from originalMetadata)
  const [selectedModel, setSelectedModel] = useState<ImageModel>(
    (originalMetadata?.model as ImageModel) || ImageModel.PRO
  );
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    (originalMetadata?.aspectRatio as AspectRatio) || AspectRatio.SQUARE
  );
  const [selectedResolution, setSelectedResolution] = useState<ImageResolution>(
    (originalMetadata?.resolution as ImageResolution) || ImageResolution.RES_2K
  );

  // Refs
  const containerRef = useRef<HTMLDivElement>(null); // The scrollable/clippable viewport
  const contentRef = useRef<HTMLDivElement>(null);   // The transforming wrapper (scale/translate)
  const maskPreviewCanvasRef = useRef<HTMLCanvasElement>(null); // Composite preview of all region masks
  const markerCanvasRef = useRef<HTMLCanvasElement>(null); // Marker/label layer
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null); // Arrow/text annotations
  const bgImageRef = useRef<HTMLImageElement>(null); // The static background image
  const regionCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Tools
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [brushSize, setBrushSize] = useState(15);
  const [brushColor, setBrushColor] = useState('#ef4444'); // Region color (UI only)
  const [textSize, setTextSize] = useState(22);
  const [textSizeInput, setTextSizeInput] = useState('22');

  // State
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [regions, setRegions] = useState<RegionState[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [nextLabelIndex, setNextLabelIndex] = useState(1);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [textEntry, setTextEntry] = useState<TextEntryState | null>(null);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
  const [arrowAnnotations, setArrowAnnotations] = useState<ArrowAnnotation[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [isResizingText, setIsResizingText] = useState(false);
  const [textHoverState, setTextHoverState] = useState<'none' | 'body' | 'handle'>('none');
  const [entryHoverState, setEntryHoverState] = useState<'none' | 'handle' | 'body'>('none');
  const [isResizingEntry, setIsResizingEntry] = useState(false);

  // Viewport Transform State
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const updateRegionInstruction = (id: string, instruction: string) => {
    setRegions(prev => prev.map(region => (
      region.id === id ? { ...region, instruction } : region
    )));
  };

  const applyBrushColor = (color: string) => {
    setBrushColor(color);
    if (activeTool !== 'text') return;
    if (textEntry) {
      setTextEntry(prev => (prev ? { ...prev, color } : prev));
    }
    if (selectedTextId && (!textEntry || textEntry.id !== selectedTextId)) {
      const next = textAnnotations.map(item => (
        item.id === selectedTextId ? { ...item, color } : item
      ));
      setTextAnnotations(next);
      saveState(nextLabelIndex, regions, activeRegionId ?? null, next);
    }
  };

  const getBaseTextSize = (fontSize: number) => {
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    const scaleFactor = annotationCtx ? Math.max(1, getDynamicScaleFactor(annotationCtx)) : 1;
    return Math.max(8, Math.round(fontSize / scaleFactor));
  };

  const selectTextAnnotation = (annotation: TextAnnotation) => {
    setSelectedTextId(annotation.id);
    setTextSize(getBaseTextSize(annotation.fontSize));
  };

  const handleSelectRegion = (id: string) => {
    setActiveRegionId(id);
    const region = regions.find(r => r.id === id);
    if (region) {
      setBrushColor(region.color);
    }
  };

  const clampTextSize = (value: number) => Math.min(96, Math.max(12, Math.round(value)));

  const applyTextSize = (value: number) => {
    const nextValue = clampTextSize(value);
    setTextSize(nextValue);
    if (activeTool !== 'text') return;
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    const scaleFactor = annotationCtx ? Math.max(1, getDynamicScaleFactor(annotationCtx)) : 1;
    const nextFontSize = Math.round(nextValue * scaleFactor);

    if (textEntry) {
      const layout = annotationCtx
        ? getTextLayout(annotationCtx, textEntry.value, nextFontSize, textEntry.width)
        : null;
      setTextEntry(prev => prev
        ? {
          ...prev,
          fontSize: nextFontSize,
          height: Math.max(prev.height, layout?.height ?? prev.height)
        }
        : prev);
    }

    if (selectedTextId && (!textEntry || textEntry.id !== selectedTextId)) {
      const next = textAnnotations.map(item => {
        if (item.id !== selectedTextId) return item;
        const layout = annotationCtx ? getTextLayout(annotationCtx, item.text, nextFontSize, item.width) : null;
        return {
          ...item,
          fontSize: nextFontSize,
          height: Math.max(item.height, layout?.height ?? item.height)
        };
      });
      setTextAnnotations(next);
      saveState(nextLabelIndex, regions, activeRegionId ?? null, next);
    }
  };

  const stopEntryResize = () => {
    setIsResizingEntry(false);
    entryResizeStartRef.current = null;
    setEntryHoverState('none');
  };

  useEffect(() => {
    if (textEntry && textInputRef.current && !textFocusRef.current) {
      textInputRef.current.focus();
      textInputRef.current.select();
      textFocusRef.current = true;
    }
    if (!textEntry) {
      textFocusRef.current = false;
    }
  }, [textEntry]);

  useEffect(() => {
    setTextSizeInput(String(textSize));
  }, [textSize]);

  useEffect(() => {
    if (activeTool !== 'text' && textEntry) {
      setTextEntry(null);
    }
    if (activeTool !== 'text' && selectedTextId) {
      setSelectedTextId(null);
    }
    if (activeTool !== 'text' && textHoverState !== 'none') {
      setTextHoverState('none');
    }
    if (activeTool !== 'text' && entryHoverState !== 'none') {
      setEntryHoverState('none');
    }
  }, [activeTool, textEntry, selectedTextId, textHoverState, entryHoverState]);

  useEffect(() => {
    renderAnnotations(textAnnotations, arrowAnnotations, textEntry ? null : selectedTextId);
  }, [textAnnotations, arrowAnnotations, selectedTextId, textEntry]);

  useEffect(() => {
    if (!textEntry && entryHoverState !== 'none') {
      setEntryHoverState('none');
    }
  }, [textEntry, entryHoverState]);

  useEffect(() => {
    if (!isResizingEntry || !textEntry) return;

    const handleMove = (event: MouseEvent) => {
      const start = entryResizeStartRef.current;
      if (!start) return;
      const point = getCanvasPointFromClient(event.clientX, event.clientY);
      if (!point.inBounds) return;

      setTextEntry(prev => {
        if (!prev) return prev;
        const annotationCanvas = annotationCanvasRef.current;
        const annotationCtx = annotationCanvas?.getContext('2d');
        const minWidth = Math.max(72, Math.round(prev.fontSize * 3.2));
        const minHeight = Math.max(16, prev.fontSize * TEXT_LINE_HEIGHT);
        const maxWidth = annotationCanvas ? Math.max(minWidth, annotationCanvas.width - prev.x) : Infinity;
        const maxHeight = annotationCanvas ? Math.max(minHeight, annotationCanvas.height - prev.y) : Infinity;

        let nextWidth = start.width + (point.x - start.x);
        let nextHeight = start.height + (point.y - start.y);
        nextWidth = Math.min(maxWidth, Math.max(minWidth, nextWidth));
        nextHeight = Math.min(maxHeight, Math.max(minHeight, nextHeight));

        if (annotationCtx) {
          const layout = getTextLayout(annotationCtx, prev.value, prev.fontSize, nextWidth);
          nextHeight = Math.min(maxHeight, Math.max(nextHeight, layout.height));
        }

        return { ...prev, width: nextWidth, height: nextHeight };
      });
    };

    const handleUp = () => {
      stopEntryResize();
    };

    const handleBlur = () => {
      stopEntryResize();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isResizingEntry, textEntry]);

  // Rect Drawing Temp State
  const dragStartRef = useRef<{ x: number, y: number } | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const textFocusRef = useRef(false);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const entryResizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Initialize Canvas Sizing once image loads
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setIsImageLoaded(true);

    if (maskPreviewCanvasRef.current && markerCanvasRef.current && annotationCanvasRef.current && containerRef.current) {
      // Match canvas resolution to native image resolution
      maskPreviewCanvasRef.current.width = img.naturalWidth;
      maskPreviewCanvasRef.current.height = img.naturalHeight;
      markerCanvasRef.current.width = img.naturalWidth;
      markerCanvasRef.current.height = img.naturalHeight;
      annotationCanvasRef.current.width = img.naturalWidth;
      annotationCanvasRef.current.height = img.naturalHeight;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });

      // Initial "Fit to Screen" Logic
      const container = containerRef.current;
      const padding = 60;
      const availableWidth = container.clientWidth - padding;
      const availableHeight = container.clientHeight - padding;

      const scaleX = availableWidth / img.naturalWidth;
      const scaleY = availableHeight / img.naturalHeight;
      const fitScale = Math.min(scaleX, scaleY, 0.9); // 0.9 to give breathing room

      setScale(fitScale);

      // Start centered at (0,0) - using flex center for positioning
      setOffset({ x: 0, y: 0 });

      // Save initial blank state
      saveState(1, []);
    }
  };

  const snapshotRegions = (regionList: RegionState[]): RegionSnapshot[] => {
    const snapshots: RegionSnapshot[] = [];
    regionList.forEach(region => {
      const canvas = regionCanvasesRef.current.get(region.id);
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        snapshots.push({
          id: region.id,
          imageData: ctx.getImageData(0, 0, canvas.width, canvas.height)
        });
      }
    });
    return snapshots;
  };

  const saveState = (
    labelIndexOverride?: number,
    regionsOverride?: RegionState[],
    activeRegionOverride?: string | null,
    textOverride?: TextAnnotation[],
    arrowOverride?: ArrowAnnotation[]
  ) => {
    const currentLabelIndex = labelIndexOverride !== undefined ? labelIndexOverride : nextLabelIndex;
    const regionList = regionsOverride ? regionsOverride.map(r => ({ ...r })) : regions.map(r => ({ ...r }));
    const textList = textOverride ? textOverride.map(item => ({ ...item })) : textAnnotations.map(item => ({ ...item }));
    const arrowList = arrowOverride ? arrowOverride.map(item => ({ ...item })) : arrowAnnotations.map(item => ({ ...item }));
    const newItem: HistoryItem = {
      regions: regionList,
      regionSnapshots: snapshotRegions(regionList),
      textAnnotations: textList,
      arrowAnnotations: arrowList,
      activeRegionId: activeRegionOverride !== undefined ? activeRegionOverride : activeRegionId,
      labelIndex: currentLabelIndex
    };

    if (history.length > 10) {
      setHistory(prev => [...prev.slice(1), newItem]);
    } else {
      setHistory(prev => [...prev, newItem]);
    }
  };

  const restoreFromHistory = (snapshot: HistoryItem) => {
    const newRegionMap = new Map<string, HTMLCanvasElement>();
    snapshot.regions.forEach(region => {
      const canvas = document.createElement('canvas');
      canvas.width = imageSize.width;
      canvas.height = imageSize.height;
      const ctx = canvas.getContext('2d');
      const data = snapshot.regionSnapshots.find(r => r.id === region.id);
      if (ctx && data) {
        ctx.putImageData(data.imageData, 0, 0);
      }
      newRegionMap.set(region.id, canvas);
    });

    regionCanvasesRef.current = newRegionMap;
    setRegions(snapshot.regions.map(r => ({ ...r })));
    setTextAnnotations(snapshot.textAnnotations.map(item => ({ ...item })));
    setArrowAnnotations(snapshot.arrowAnnotations.map(item => ({ ...item })));
    setSelectedTextId(null);
    setIsDraggingText(false);
    setIsResizingText(false);
    setActiveRegionId(snapshot.activeRegionId);
    setNextLabelIndex(snapshot.labelIndex);
    renderMaskPreview(snapshot.regions);
    renderMarkerLayer(snapshot.regions);
    renderAnnotations(snapshot.textAnnotations, snapshot.arrowAnnotations, null);
  };

  const handleUndo = () => {
    if (history.length > 1) {
      const newHistory = [...history];
      newHistory.pop(); // Remove current state
      const previousState = newHistory[newHistory.length - 1];
      restoreFromHistory(previousState);
      setHistory(newHistory);
    } else if (history.length === 1) {
      const previousState = history[0];
      restoreFromHistory(previousState);
    }
  };

  // Convert screen coordinates to canvas coordinates (accounting for CSS transform & resolution)
  const getCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = maskPreviewCanvasRef.current;
    const image = bgImageRef.current;
    const target = image || canvas;
    if (!target) return { x: 0, y: 0, inBounds: false };

    const rect = target.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const inBounds = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;

    const width = canvas?.width || image?.naturalWidth || rect.width;
    const height = canvas?.height || image?.naturalHeight || rect.height;

    // Map screen pixel to native image pixel
    const x = (clientX - rect.left) * (width / rect.width);
    const y = (clientY - rect.top) * (height / rect.height);

    const clampedX = Math.min(Math.max(x, 0), width);
    const clampedY = Math.min(Math.max(y, 0), height);

    return { x: clampedX, y: clampedY, inBounds };
  };

  const getCanvasPointFromClient = (clientX: number, clientY: number) => {
    const canvas = maskPreviewCanvasRef.current;
    const image = bgImageRef.current;
    const target = image || canvas;
    if (!target) return { x: 0, y: 0, inBounds: false };

    const rect = target.getBoundingClientRect();
    const inBounds = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;

    const width = canvas?.width || image?.naturalWidth || rect.width;
    const height = canvas?.height || image?.naturalHeight || rect.height;

    const x = (clientX - rect.left) * (width / rect.width);
    const y = (clientY - rect.top) * (height / rect.height);

    const clampedX = Math.min(Math.max(x, 0), width);
    const clampedY = Math.min(Math.max(y, 0), height);

    return { x: clampedX, y: clampedY, inBounds };
  };



  const getScreenCoordinates = (x: number, y: number) => {
    const canvas = maskPreviewCanvasRef.current;
    const image = bgImageRef.current;
    const target = image || canvas;
    if (!target) return { x: 0, y: 0 };
    const rect = target.getBoundingClientRect();
    const width = canvas?.width || image?.naturalWidth || rect.width;
    const height = canvas?.height || image?.naturalHeight || rect.height;
    return {
      x: rect.left + (x / width) * rect.width,
      y: rect.top + (y / height) * rect.height
    };
  };

  const getCanvasScale = () => {
    const canvas = maskPreviewCanvasRef.current;
    const image = bgImageRef.current;
    const target = image || canvas;
    if (!target) return { x: 1, y: 1 };
    const rect = target.getBoundingClientRect();
    const width = canvas?.width || image?.naturalWidth || rect.width;
    const height = canvas?.height || image?.naturalHeight || rect.height;
    return {
      x: rect.width / width,
      y: rect.height / height
    };
  };

  const measureEntryBox = (text: string, fontSize: number) => {
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    if (!annotationCtx) {
      return { width: 140, height: Math.max(16, fontSize * TEXT_LINE_HEIGHT) };
    }
    const trimmed = text.trim();
    const sample = trimmed.length > 0 ? trimmed : ' ';
    const metrics = measureTextBox(annotationCtx, sample, fontSize);
    const defaultWidth = Math.max(140, Math.round(fontSize * 6));
    const minWidth = Math.max(72, Math.round(fontSize * 3.2));
    return {
      width: trimmed.length > 0 ? Math.max(minWidth, metrics.width) : defaultWidth,
      height: Math.max(16, metrics.height)
    };
  };

  const openTextEntry = (e: React.MouseEvent | React.TouchEvent, annotation?: TextAnnotation) => {
    if (textEntry) return;
    const { x, y, inBounds } = getCanvasCoordinates(e);
    if (!inBounds) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    const scaleFactor = annotationCtx ? Math.max(1, getDynamicScaleFactor(annotationCtx)) : 1;
    const fontSize = annotation?.fontSize ?? Math.round(textSize * scaleFactor);
    const color = annotation?.color ?? brushColor;
    const { width, height } = measureEntryBox(annotation?.text ?? '', fontSize);

    const entryX = annotation ? annotation.x : x;
    const entryY = annotation ? annotation.y : y;
    const screenPoint = getScreenCoordinates(entryX - TEXT_BOX_PADDING, entryY - TEXT_BOX_PADDING);
    setTextEntry({
      id: annotation?.id,
      x: entryX,
      y: entryY,
      screenX: screenPoint.x - rect.left,
      screenY: screenPoint.y - rect.top,
      value: annotation?.text ?? '',
      width: annotation?.width ?? width,
      height: annotation?.height ?? height,
      fontSize,
      color
    });
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

  const handleClick = (e: React.MouseEvent) => {
    if (isPanning || activeTool !== 'text') return;
    if (textEntry) return;
    const { x, y, inBounds } = getCanvasCoordinates(e);
    if (!inBounds) return;
    const hit = getTextHit(x, y);
    if (hit) {
      selectTextAnnotation(hit.annotation);
      return;
    }
    setSelectedTextId(null);
    openTextEntry(e);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isPanning || activeTool !== 'text') return;
    const { x, y, inBounds } = getCanvasCoordinates(e);
    if (!inBounds) return;
    const hit = getTextHit(x, y);
    if (!hit) return;
    selectTextAnnotation(hit.annotation);
    openTextEntry(e, hit.annotation);
  };

  const handleTextEntryMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!textEntry || !textEntryOverlay) return;
    if (isResizingEntry) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const handleSize = textEntryOverlay.handleSize;
    const onHandle =
      e.clientX >= rect.right - handleSize - 2 &&
      e.clientY >= rect.bottom - handleSize - 2;
    setEntryHoverState(onHandle ? 'handle' : 'body');
  };

  const handleTextEntryMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!textEntry || !textEntryOverlay) return;
    if (e.target === textInputRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const handleSize = textEntryOverlay.handleSize;
    const onHandle =
      e.clientX >= rect.right - handleSize - 2 &&
      e.clientY >= rect.bottom - handleSize - 2;
    if (!onHandle) return;
    e.preventDefault();
    e.stopPropagation();
    const point = getCanvasPointFromClient(e.clientX, e.clientY);
    entryResizeStartRef.current = {
      x: point.x,
      y: point.y,
      width: textEntry.width,
      height: textEntry.height
    };
    setIsResizingEntry(true);
    setEntryHoverState('handle');
  };

  const handleTextEntryMouseLeave = () => {
    if (!isResizingEntry) {
      setEntryHoverState('none');
    }
  };

  const handleTextEntryMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isResizingEntry) return;
    e.stopPropagation();
    stopEntryResize();
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    const newScale = Math.min(Math.max(0.1, scale + delta), 5); // Limit zoom 0.1x to 5x
    setScale(newScale);
  };

  const renderMarkerLayer = (regionList: RegionState[] = regions) => {
    const canvas = markerCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    regionList.forEach(region => {
      if (region.markerPosition) {
        drawMarker(ctx, region.markerPosition.x, region.markerPosition.y, region.id, region.color);
      }
      if (region.rectLabelPosition) {
        drawRectLabel(ctx, region.rectLabelPosition.x, region.rectLabelPosition.y, region.id, region.color);
      }
    });
  };

  const renderMaskPreview = (regionList?: RegionState[]) => {
    const canvas = maskPreviewCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!regionList) {
      regionCanvasesRef.current.forEach(regionCanvas => {
        ctx.drawImage(regionCanvas, 0, 0);
      });
      return;
    }
    regionList.forEach(region => {
      const regionCanvas = regionCanvasesRef.current.get(region.id);
      if (regionCanvas) {
        ctx.drawImage(regionCanvas, 0, 0);
      }
    });
  };

  const createRegionCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    return canvas;
  };

  const createRegion = (
    markerPosition?: { x: number; y: number },
    options?: { skipHistory?: boolean; instruction?: string }
  ): RegionCreationResult => {
    const id = String(nextLabelIndex);
    const nextIndex = nextLabelIndex + 1;
    const newRegion: RegionState = {
      id,
      color: brushColor,
      instruction: options?.instruction ?? '',
      markerPosition
    };
    const updatedRegions = [...regions, newRegion];
    regionCanvasesRef.current.set(id, createRegionCanvas());
    setRegions(updatedRegions);
    setActiveRegionId(id);
    setNextLabelIndex(nextIndex);
    renderMarkerLayer(updatedRegions);
    renderMaskPreview(updatedRegions);
    if (!options?.skipHistory) {
      saveState(nextIndex, updatedRegions, id);
    }
    return { region: newRegion, regions: updatedRegions, nextLabelIndex: nextIndex };
  };

  const getActiveRegion = () => {
    return activeRegionId ? regions.find(r => r.id === activeRegionId) : undefined;
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: { color?: string; lineWidth?: number; headLength?: number }
  ) => {
    const scaleFactor = Math.max(1, getDynamicScaleFactor(ctx));
    const lineWidth = options?.lineWidth ?? Math.max(2, brushSize * 0.2);
    const headLength = options?.headLength ?? Math.max(26 * scaleFactor, lineWidth * 7);
    const color = options?.color ?? brushColor;
    const angle = Math.atan2(endY - startY, endX - startX);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - Math.PI / 6),
      endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      endX - headLength * Math.cos(angle + Math.PI / 6),
      endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const measureTextBox = (ctx: CanvasRenderingContext2D, text: string, fontSize: number) => {
    ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
    const lines = text.split('\n');
    const width = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    const height = Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT;
    return { width, height };
  };

  const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    if (!text) return [''];
    if (maxWidth <= 0) return [text];
    const paragraphs = text.split('\n');
    const lines: string[] = [];

    paragraphs.forEach((paragraph) => {
      if (paragraph.length === 0) {
        lines.push('');
        return;
      }

      let current = '';
      let lastSpaceIndex = -1;

      for (let i = 0; i < paragraph.length; i += 1) {
        const char = paragraph[i];
        current += char;
        if (char === ' ') {
          lastSpaceIndex = current.length - 1;
        }

        if (ctx.measureText(current).width > maxWidth && current.length > 1) {
          if (lastSpaceIndex > -1) {
            const line = current.slice(0, lastSpaceIndex);
            lines.push(line);
            current = current.slice(lastSpaceIndex + 1);
            lastSpaceIndex = current.lastIndexOf(' ');
          } else {
            lines.push(current.slice(0, -1));
            current = char;
            lastSpaceIndex = char === ' ' ? 0 : -1;
          }
        }
      }

      lines.push(current);
    });

    return lines;
  };

  const getTextLayout = (
    ctx: CanvasRenderingContext2D,
    text: string,
    fontSize: number,
    maxWidth: number
  ) => {
    ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
    const lines = wrapTextLines(ctx, text, maxWidth);
    const lineHeight = fontSize * TEXT_LINE_HEIGHT;
    const height = Math.max(1, lines.length) * lineHeight;
    return { lines, lineHeight, height };
  };

  const drawTextAnnotation = (ctx: CanvasRenderingContext2D, annotation: TextAnnotation) => {
    ctx.save();
    ctx.font = `600 ${annotation.fontSize}px "Inter", sans-serif`;
    ctx.fillStyle = annotation.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(2, annotation.fontSize * 0.12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const { lines, lineHeight } = getTextLayout(ctx, annotation.text, annotation.fontSize, annotation.width);
    const maxLines = Math.max(1, Math.floor(annotation.height / lineHeight));
    lines.slice(0, maxLines).forEach((line, index) => {
      const lineY = annotation.y + index * lineHeight;
      ctx.strokeText(line, annotation.x, lineY);
      ctx.fillText(line, annotation.x, lineY);
    });
    ctx.restore();
  };

  const drawTextSelection = (ctx: CanvasRenderingContext2D, annotation: TextAnnotation) => {
    const padding = TEXT_BOX_PADDING;
    const handleSize = Math.max(10, annotation.fontSize * 0.4);
    const x = annotation.x - padding;
    const y = annotation.y - padding;
    const width = annotation.width + padding * 2;
    const height = annotation.height + padding * 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x + width - handleSize, y + height - handleSize, handleSize, handleSize);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeRect(x + width - handleSize, y + height - handleSize, handleSize, handleSize);
    ctx.restore();
  };

  const renderAnnotations = (
    textList: TextAnnotation[] = textAnnotations,
    arrowList: ArrowAnnotation[] = arrowAnnotations,
    selectedId: string | null = selectedTextId,
    previewArrow?: ArrowAnnotation
  ) => {
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    if (!annotationCanvas || !annotationCtx) return;

    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

    arrowList.forEach(arrow => {
      drawArrow(annotationCtx, arrow.startX, arrow.startY, arrow.endX, arrow.endY, {
        color: arrow.color,
        lineWidth: arrow.lineWidth,
        headLength: arrow.headLength
      });
    });

    if (previewArrow) {
      drawArrow(annotationCtx, previewArrow.startX, previewArrow.startY, previewArrow.endX, previewArrow.endY, {
        color: previewArrow.color,
        lineWidth: previewArrow.lineWidth,
        headLength: previewArrow.headLength
      });
    }

    const editingId = textEntry?.id;
    textList.forEach(annotation => {
      if (editingId && annotation.id === editingId) {
        return;
      }
      drawTextAnnotation(annotationCtx, annotation);
      if (selectedId && annotation.id === selectedId) {
        drawTextSelection(annotationCtx, annotation);
      }
    });
  };

  const getTextHit = (x: number, y: number) => {
    for (let i = textAnnotations.length - 1; i >= 0; i -= 1) {
      const annotation = textAnnotations[i];
      const padding = TEXT_BOX_PADDING;
      const boxX = annotation.x - padding;
      const boxY = annotation.y - padding;
      const boxWidth = annotation.width + padding * 2;
      const boxHeight = annotation.height + padding * 2;
      const handleSize = Math.max(10, annotation.fontSize * 0.4);
      const handleX = boxX + boxWidth - handleSize;
      const handleY = boxY + boxHeight - handleSize;
      const onHandle = x >= handleX && x <= handleX + handleSize && y >= handleY && y <= handleY + handleSize;
      if (onHandle) {
        return { annotation, onHandle: true };
      }
      const within =
        x >= boxX &&
        x <= boxX + boxWidth &&
        y >= boxY &&
        y <= boxY + boxHeight;
      if (within) {
        return { annotation, onHandle: false };
      }
    }
    return null;
  };

  const updateRegionInstructionLine = (regionId: string, oldText: string | undefined, newText: string) => {
    const updated = regions.map(region => {
      if (region.id !== regionId) return region;
      const lines = (region.instruction || '').split('\n').filter(Boolean);
      if (oldText) {
        const idx = lines.findIndex(line => line.trim() === oldText.trim());
        if (idx >= 0) {
          lines[idx] = newText;
          return { ...region, instruction: lines.join('\n') };
        }
      }
      return { ...region, instruction: lines.concat(newText).join('\n') };
    });
    setRegions(updated);
    return updated;
  };

  const applyTextAnnotation = (
    x: number,
    y: number,
    text: string,
    editingId?: string,
    options?: { width?: number; height?: number; fontSize?: number; color?: string }
  ) => {
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    if (!annotationCanvas || !annotationCtx) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    if (editingId) {
      let updatedRegions = regions;
      const next = textAnnotations.map(item => {
        if (item.id !== editingId) return item;
        const nextWidth = options?.width ?? item.width;
        const nextFontSize = options?.fontSize ?? item.fontSize;
        const layout = getTextLayout(annotationCtx, trimmed, nextFontSize, nextWidth);
        const nextHeight = Math.max(options?.height ?? item.height, layout.height);
        if (item.regionId) {
          updatedRegions = updateRegionInstructionLine(item.regionId, item.instructionText, trimmed);
        }
        return {
          ...item,
          text: trimmed,
          width: nextWidth,
          height: nextHeight,
          fontSize: nextFontSize,
          color: options?.color ?? item.color,
          instructionText: item.regionId ? trimmed : item.instructionText
        };
      });
      setTextAnnotations(next);
      setSelectedTextId(editingId);
      saveState(nextLabelIndex, updatedRegions, activeRegionId ?? null, next);
      return;
    }

    const scaleFactor = Math.max(1, getDynamicScaleFactor(annotationCtx));
    const fontSize = options?.fontSize ?? Math.round(textSize * scaleFactor);
    const width = options?.width ?? measureEntryBox(trimmed, fontSize).width;
    const layout = getTextLayout(annotationCtx, trimmed, fontSize, width);
    const height = Math.max(options?.height ?? measureEntryBox(trimmed, fontSize).height, layout.height);
    const regionId = activeRegionId || undefined;
    const updatedRegions = regionId ? updateRegionInstructionLine(regionId, undefined, trimmed) : regions;

    const newId = crypto.randomUUID();
    const next = textAnnotations.concat([{
      id: newId,
      x,
      y,
      text: trimmed,
      color: options?.color ?? brushColor,
      fontSize,
      width,
      height,
      regionId,
      instructionText: regionId ? trimmed : undefined
    }]);
    setTextAnnotations(next);
    setSelectedTextId(newId);
    saveState(nextLabelIndex, updatedRegions, activeRegionId ?? null, next);
  };

  const handleTextCommit = () => {
    if (!textEntry) return;
    const trimmed = textEntry.value.trim();
    const entryId = textEntry.id;
    const { x, y, width, height, fontSize, color } = textEntry;
    setTextEntry(null);
    if (!trimmed) return;
    applyTextAnnotation(x, y, trimmed, entryId, { width, height, fontSize, color });
  };

  const handleTextCancel = () => {
    setTextEntry(null);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y, inBounds } = getCanvasCoordinates(e);
    if (!inBounds) return;

    if (activeTool === 'marker') {
      createRegion({ x, y });
      return;
    }

    if (activeTool === 'text') {
      const hit = getTextHit(x, y);
      if (hit) {
        selectTextAnnotation(hit.annotation);
        if (hit.onHandle) {
          setIsResizingText(true);
          resizeStartRef.current = { x, y, width: hit.annotation.width, height: hit.annotation.height };
        } else {
          setIsDraggingText(true);
          dragOffsetRef.current = { x: x - hit.annotation.x, y: y - hit.annotation.y };
        }
      } else {
        setSelectedTextId(null);
      }
      return;
    }

    if (activeTool === 'arrow') {
      const annotationCanvas = annotationCanvasRef.current;
      const annotationCtx = annotationCanvas?.getContext('2d');
      if (!annotationCanvas || !annotationCtx) return;
      setIsDrawing(true);
      arrowStartRef.current = { x, y };
      return;
    }

    let region = getActiveRegion();
    if (!region && (activeTool === 'brush' || activeTool === 'eraser')) {
      region = createRegion(undefined, { skipHistory: true }).region;
    }
    if (activeTool === 'rect') {
      const created = createRegion();
      region = created.region;
    }

    if (!region) return;

    if (region.color !== brushColor) {
      const updatedRegions = regions.map(r =>
        r.id === region?.id ? { ...r, color: brushColor } : r
      );
      setRegions(updatedRegions);
      renderMarkerLayer(updatedRegions);
      region = updatedRegions.find(r => r.id === region?.id) || region;
    }

    const regionCanvas = regionCanvasesRef.current.get(region.id);
    const ctx = regionCanvas?.getContext('2d');

    if (ctx && regionCanvas) {
      if (activeTool === 'brush' || activeTool === 'eraser') {
        setIsDrawing(true);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;

        if (activeTool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = brushColor;
        }
      } else if (activeTool === 'rect') {
        setIsDrawing(true);
        ctx.globalCompositeOperation = 'source-over';
        dragStartRef.current = { x, y };
        snapshotRef.current = ctx.getImageData(0, 0, regionCanvas.width, regionCanvas.height);
      }
    }
  };

  const getDynamicScaleFactor = (ctx: CanvasRenderingContext2D) => {
    // Scale UI elements (text, markers) so they look good on 4K images or small icons
    return Math.max(ctx.canvas.width, ctx.canvas.height) / 1500;
  };

  const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string) => {
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
    ctx.fillStyle = color;
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
    ctx.fillText(label, x, y + (radius * 0.1)); // optical center adj
    ctx.restore();
  };

  const drawRectLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string) => {
    const scaleFactor = Math.max(1, getDynamicScaleFactor(ctx));
    const fontSize = Math.round(14 * scaleFactor);
    const paddingX = 8 * scaleFactor;
    const paddingY = 4 * scaleFactor;
    ctx.save();
    ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
    const metrics = ctx.measureText(label);
    const width = metrics.width + paddingX * 2;
    const height = fontSize + paddingY * 2;
    const radius = 6 * scaleFactor;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + paddingX, y + paddingY);
    ctx.restore();
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCanvasCoordinates(e);

    if (activeTool === 'text' && selectedTextId && (isDraggingText || isResizingText)) {
      setTextAnnotations(prev => prev.map(item => {
        if (item.id !== selectedTextId) return item;
        if (isDraggingText && dragOffsetRef.current) {
          const annotationCanvas = annotationCanvasRef.current;
          const maxX = annotationCanvas ? Math.max(0, annotationCanvas.width - item.width) : Infinity;
          const maxY = annotationCanvas ? Math.max(0, annotationCanvas.height - item.height) : Infinity;
          const newX = Math.min(Math.max(0, x - dragOffsetRef.current.x), maxX);
          const newY = Math.min(Math.max(0, y - dragOffsetRef.current.y), maxY);
          return { ...item, x: newX, y: newY };
        }
        if (isResizingText && resizeStartRef.current) {
          const annotationCanvas = annotationCanvasRef.current;
          const annotationCtx = annotationCanvas?.getContext('2d');
          if (!annotationCtx) return item;
          const minWidth = Math.max(72, Math.round(item.fontSize * 3.2));
          const minHeight = Math.max(16, item.fontSize * TEXT_LINE_HEIGHT);
          const maxWidth = annotationCanvas ? Math.max(minWidth, annotationCanvas.width - item.x) : Infinity;
          const maxHeight = annotationCanvas ? Math.max(minHeight, annotationCanvas.height - item.y) : Infinity;

          let nextWidth = resizeStartRef.current.width + (x - resizeStartRef.current.x);
          let nextHeight = resizeStartRef.current.height + (y - resizeStartRef.current.y);
          nextWidth = Math.min(maxWidth, Math.max(minWidth, nextWidth));
          nextHeight = Math.min(maxHeight, Math.max(minHeight, nextHeight));

          const layout = getTextLayout(annotationCtx, item.text, item.fontSize, nextWidth);
          nextHeight = Math.min(maxHeight, Math.max(nextHeight, layout.height));

          return { ...item, width: nextWidth, height: nextHeight };
        }
        return item;
      }));
      return;
    }

    if (activeTool === 'text' && !isDrawing && !isDraggingText && !isResizingText) {
      const hit = getTextHit(x, y);
      const nextHover = hit ? (hit.onHandle ? 'handle' : 'body') : 'none';
      setTextHoverState(prev => (prev === nextHover ? prev : nextHover));
    } else if (textHoverState !== 'none') {
      setTextHoverState('none');
    }

    if (!isDrawing) return;

    if (activeTool === 'arrow' && arrowStartRef.current) {
      const annotationCanvas = annotationCanvasRef.current;
      const annotationCtx = annotationCanvas?.getContext('2d');
      if (!annotationCanvas || !annotationCtx) return;
      const lineWidth = Math.max(2, brushSize * 0.2);
      const headLength = Math.max(26 * Math.max(1, getDynamicScaleFactor(annotationCtx)), lineWidth * 7);
      renderAnnotations(textAnnotations, arrowAnnotations, selectedTextId, {
        id: 'preview',
        startX: arrowStartRef.current.x,
        startY: arrowStartRef.current.y,
        endX: x,
        endY: y,
        color: brushColor,
        lineWidth,
        headLength
      });
      return;
    }

    const region = getActiveRegion();
    if (!region) return;
    const regionCanvas = regionCanvasesRef.current.get(region.id);
    const ctx = regionCanvas?.getContext('2d');

    if (ctx && regionCanvas) {
      if (activeTool === 'brush' || activeTool === 'eraser') {
        ctx.lineTo(x, y);
        ctx.stroke();
        renderMaskPreview();
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
        ctx.lineWidth = Math.max(4, regionCanvas.width * 0.003);
        ctx.strokeRect(startX, startY, width, height);
        renderMaskPreview();
      }
    }
  };

  const stopDrawing = () => {
    if (activeTool === 'arrow') {
      setIsDrawing(false);
      const annotationCanvas = annotationCanvasRef.current;
      const annotationCtx = annotationCanvas?.getContext('2d');
      if (!annotationCanvas || !annotationCtx || !arrowStartRef.current) {
        arrowStartRef.current = null;
        return;
      }

      const endPoint = lastMouseEventRef.current
        ? getCanvasCoordinates(lastMouseEventRef.current)
        : arrowStartRef.current;

      const lineWidth = Math.max(2, brushSize * 0.2);
      const headLength = Math.max(26 * Math.max(1, getDynamicScaleFactor(annotationCtx)), lineWidth * 7);
      const next = arrowAnnotations.concat([{
        id: crypto.randomUUID(),
        startX: arrowStartRef.current!.x,
        startY: arrowStartRef.current!.y,
        endX: endPoint.x,
        endY: endPoint.y,
        color: brushColor,
        lineWidth,
        headLength
      }]);
      setArrowAnnotations(next);
      saveState(nextLabelIndex, regions, activeRegionId ?? null, undefined, next);
      arrowStartRef.current = null;
      return;
    }

    if (activeTool === 'text' && (isDraggingText || isResizingText)) {
      setIsDraggingText(false);
      setIsResizingText(false);
      dragOffsetRef.current = null;
      resizeStartRef.current = null;
      saveState(nextLabelIndex, regions, activeRegionId ?? null);
      return;
    }

    if (!isDrawing) return;

    setIsDrawing(false);
    const region = activeRegionId ? regions.find(r => r.id === activeRegionId) : undefined;
    const regionCanvas = region ? regionCanvasesRef.current.get(region.id) : undefined;
    const regionCtx = regionCanvas?.getContext('2d');

    if (activeTool === 'brush' || activeTool === 'eraser') {
      regionCtx?.closePath();
      if (regionCtx) regionCtx.globalCompositeOperation = 'source-over';
      renderMaskPreview();
      saveState(nextLabelIndex);
    } else if (activeTool === 'rect') {
      if (region && regionCtx && dragStartRef.current) {
        // FIX: Null check for lastMouseEventRef to prevent crash when clicking without moving
        let endX = dragStartRef.current.x;
        let endY = dragStartRef.current.y;

        if (lastMouseEventRef.current) {
          const coords = getCanvasCoordinates(lastMouseEventRef.current);
          endX = coords.x;
          endY = coords.y;
        }

        const x = Math.min(dragStartRef.current.x, endX);
        const y = Math.min(dragStartRef.current.y, endY);

        const updatedRegions = regions.map(r =>
          r.id === region.id ? { ...r, rectLabelPosition: { x: x + 6, y: y + 6 } } : r
        );
        setRegions(updatedRegions);
        renderMarkerLayer(updatedRegions);
        saveState(nextLabelIndex, updatedRegions, region.id);
      }
      dragStartRef.current = null;
      snapshotRef.current = null;
    }
  };

  const lastMouseEventRef = useRef<React.MouseEvent | React.TouchEvent | null>(null);

  const exportMaskDataUrl = (drawingCanvas: HTMLCanvasElement): string => {
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

  const buildSavePayload = (): CanvasEditorExportPayload | null => {
    if (!bgImageRef.current || !maskPreviewCanvasRef.current || !markerCanvasRef.current || !annotationCanvasRef.current) return null;
    const selectionId = selectedTextId;
    if (selectionId) {
      renderAnnotations(textAnnotations, arrowAnnotations, null);
    }

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = maskPreviewCanvasRef.current.width;
    baseCanvas.height = maskPreviewCanvasRef.current.height;
    const baseCtx = baseCanvas.getContext('2d');

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = maskPreviewCanvasRef.current.width;
    previewCanvas.height = maskPreviewCanvasRef.current.height;
    const previewCtx = previewCanvas.getContext('2d');

    const mergedMaskCanvas = document.createElement('canvas');
    mergedMaskCanvas.width = maskPreviewCanvasRef.current.width;
    mergedMaskCanvas.height = maskPreviewCanvasRef.current.height;
    const mergedCtx = mergedMaskCanvas.getContext('2d');

    if (!baseCtx || !previewCtx || !mergedCtx) return null;

    // Base image
    baseCtx.drawImage(bgImageRef.current, 0, 0);
    const baseImageDataUrl = baseCanvas.toDataURL('image/png');

    // Preview (base + mask preview + annotations)
    previewCtx.drawImage(bgImageRef.current, 0, 0);
    previewCtx.drawImage(maskPreviewCanvasRef.current, 0, 0);
    previewCtx.drawImage(markerCanvasRef.current, 0, 0);
    previewCtx.drawImage(annotationCanvasRef.current, 0, 0);
    const previewDataUrl = previewCanvas.toDataURL('image/png');

    // Merged mask (union)
    mergedCtx.fillStyle = 'black';
    mergedCtx.fillRect(0, 0, mergedMaskCanvas.width, mergedMaskCanvas.height);
    regions.forEach(region => {
      const regionCanvas = regionCanvasesRef.current.get(region.id);
      if (regionCanvas) {
        mergedCtx.drawImage(regionCanvas, 0, 0);
      }
    });
    const mergedMaskDataUrl = exportMaskDataUrl(mergedMaskCanvas);

    const regionExports: CanvasEditRegionExport[] = regions.map(region => {
      const regionCanvas = regionCanvasesRef.current.get(region.id);
      const maskDataUrl = regionCanvas ? exportMaskDataUrl(regionCanvas) : '';
      return {
        id: region.id,
        color: region.color,
        instruction: region.instruction,
        maskDataUrl
      };
    });

    if (selectionId) {
      renderAnnotations(textAnnotations, arrowAnnotations, selectionId);
    }

    return {
      baseImageDataUrl,
      previewDataUrl,
      mergedMaskDataUrl,
      regions: regionExports
    };
  };

  const handleSaveToConfig = () => {
    const payload = buildSavePayload();
    if (payload) {
      onSaveToConfig(payload);
      onClose();
    }
  };

  const handleSaveToChat = () => {
    const payload = buildSavePayload();
    if (payload) {
      onSaveToChat(payload);
      onClose();
    }
  };

  const handleClear = () => {
    regionCanvasesRef.current.clear();
    setRegions([]);
    setActiveRegionId(null);
    setNextLabelIndex(1);
    setTextEntry(null);
    setTextAnnotations([]);
    setArrowAnnotations([]);
    setSelectedTextId(null);
    setIsDraggingText(false);
    setIsResizingText(false);
    const annotationCanvas = annotationCanvasRef.current;
    const annotationCtx = annotationCanvas?.getContext('2d');
    if (annotationCanvas && annotationCtx) {
      annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    }
    renderMaskPreview([]);
    renderMarkerLayer([]);
    renderAnnotations([], [], null);
    saveState(1, [], null);
  };

  const textEntryScale = textEntry ? getCanvasScale() : { x: 1, y: 1 };
  const textEntryScaleFactor = Math.min(textEntryScale.x, textEntryScale.y);
  const textEntryOverlay = textEntry
    ? {
      width: (textEntry.width + TEXT_BOX_PADDING * 2) * textEntryScale.x,
      height: (textEntry.height + TEXT_BOX_PADDING * 2) * textEntryScale.y,
      inputWidth: textEntry.width * textEntryScale.x,
      inputHeight: textEntry.height * textEntryScale.y,
      paddingX: TEXT_BOX_PADDING * textEntryScale.x,
      paddingY: TEXT_BOX_PADDING * textEntryScale.y,
      fontSize: textEntry.fontSize * textEntryScaleFactor,
      handleSize: Math.max(10, textEntry.fontSize * 0.4) * textEntryScaleFactor
    }
    : null;

  // Click outside to close dropdowns
  const addToContainerRef = useRef<HTMLDivElement>(null);
  const generateContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAddToMenu && addToContainerRef.current && !addToContainerRef.current.contains(event.target as Node)) {
        setShowAddToMenu(false);
      }
      if (showGeneratePanel && generateContainerRef.current && !generateContainerRef.current.contains(event.target as Node)) {
        setShowGeneratePanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddToMenu, showGeneratePanel]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-panel z-[100] shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-brand-500/20 rounded-lg">
            {activeTool === 'brush' && <Brush size={20} className="text-brand-500" />}
            {activeTool === 'eraser' && <Eraser size={20} className="text-brand-500" />}
            {activeTool === 'rect' && <Square size={20} className="text-brand-500" />}
            {activeTool === 'marker' && <MousePointer2 size={20} className="text-brand-500" />}
            {activeTool === 'arrow' && <ArrowUpRight size={20} className="text-brand-500" />}
            {activeTool === 'text' && <Type size={20} className="text-brand-500" />}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{t('editor.title')}</h2>
            <p className="text-xs text-gray-400">Shift+Drag to Pan • Scroll to Zoom</p>
          </div>
        </div>

        <div className="flex items-center gap-3 relative">
          {/* Cancel Button */}
          <button onClick={onClose} className="px-3 py-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
            {t('editor.cancel')}
          </button>

          {/* Add To Dropdown */}
          <div className="relative" ref={addToContainerRef}>
            <button
              onClick={() => { setShowAddToMenu(!showAddToMenu); setShowGeneratePanel(false); }}
              className="p-2.5 bg-dark-card border border-dark-border hover:border-brand-500/50 rounded-lg text-gray-300 hover:text-white transition-all"
              title="添加到..."
            >
              <Forward size={18} />
            </button>
            {showAddToMenu && (
              <div className="absolute right-0 top-full mt-2 w-40 bg-dark-surface border border-dark-border rounded-xl shadow-2xl overflow-hidden z-[999]">
                <button
                  onClick={() => { handleSaveToConfig(); setShowAddToMenu(false); }}
                  className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <Settings size={16} />
                  参数配置
                </button>
                <button
                  onClick={() => { handleSaveToChat(); setShowAddToMenu(false); }}
                  className="w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors border-t border-dark-border"
                >
                  <MessageCircle size={16} />
                  AI 对话
                </button>
              </div>
            )}
          </div>

          {/* Regenerate Dropdown */}
          <div className="relative" ref={generateContainerRef}>
            <button
              onClick={() => { setShowGeneratePanel(!showGeneratePanel); setShowAddToMenu(false); }}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all"
            >
              <Sparkles size={16} />
              重新生成
              <ChevronDown size={14} className={`transition-transform ${showGeneratePanel ? 'rotate-180' : ''}`} />
            </button>
            {showGeneratePanel && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-dark-surface border border-dark-border rounded-xl shadow-2xl p-4 z-[999]">
                <div className="space-y-4">
                  {/* Model Selection */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">模型</label>
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => {
                          const model = e.target.value as ImageModel;
                          setSelectedModel(model);
                          // Reset resolution if switching to Flash
                          if (model === ImageModel.FLASH) {
                            setSelectedResolution(ImageResolution.RES_1K);
                          }
                        }}
                        className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2.5 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors"
                      >
                        <option value={ImageModel.FLASH}>Flash</option>
                        <option value={ImageModel.PRO}>Pro</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-3 text-gray-500 pointer-events-none" size={16} />
                    </div>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">比例</label>
                    <div className="relative">
                      <select
                        value={selectedAspectRatio}
                        onChange={(e) => setSelectedAspectRatio(e.target.value as AspectRatio)}
                        className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2.5 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors"
                      >
                        <option value="1:1">1:1</option>
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-3 text-gray-500 pointer-events-none" size={16} />
                    </div>
                  </div>

                  {/* Resolution */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">分辨率</label>
                    <div className="relative">
                      <select
                        value={selectedResolution}
                        onChange={(e) => setSelectedResolution(e.target.value as ImageResolution)}
                        className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2.5 text-sm text-white appearance-none focus:border-brand-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={selectedModel === ImageModel.FLASH}
                      >
                        {(RESOLUTION_OPTIONS[selectedModel] || [ImageResolution.RES_1K, ImageResolution.RES_2K]).map(res => (
                          <option key={res} value={res}>{res}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-3 text-gray-500 pointer-events-none" size={16} />
                    </div>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={() => {
                    if (onDirectGenerate) {
                      const payload = buildSavePayload();
                      if (payload) {
                        onDirectGenerate(payload, {
                          imageModel: selectedModel,
                          aspectRatio: selectedAspectRatio,
                          imageResolution: selectedResolution
                        });
                        onClose();
                      }
                    }
                    setShowGeneratePanel(false);
                  }}
                  disabled={!onDirectGenerate}
                  className="w-full mt-4 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-all"
                >
                  <Sparkles size={16} />
                  开始生成
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="h-14 border-b border-dark-border bg-dark-surface flex flex-nowrap items-center justify-start gap-6 px-6 shrink-0 z-20 overflow-x-auto overflow-y-hidden">

        {/* Undo/Reset */}
        <div className="flex items-center gap-2 border-r border-dark-border pr-6 shrink-0">
          <button onClick={handleUndo} disabled={history.length <= 1} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 transition-colors" title={t('editor.undo')}>
            <Undo size={18} />
          </button>
          <button onClick={handleClear} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title={t('editor.reset')}>
            <Eraser size={18} />
          </button>
        </div>

        {/* Tools */}
        <div className="flex flex-nowrap items-center gap-2 p-1 bg-black/20 rounded-lg border border-white/5 shrink-0">
          <button onClick={() => setActiveTool('marker')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'marker' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            <MousePointer2 size={14} /> Markers
          </button>
          <button onClick={() => setActiveTool('arrow')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'arrow' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            <ArrowUpRight size={14} /> {t('editor.arrow')}
          </button>
          <button onClick={() => setActiveTool('text')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTool === 'text' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            <Type size={14} /> {t('editor.text')}
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
        {(activeTool === 'brush' || activeTool === 'rect' || activeTool === 'marker' || activeTool === 'arrow' || activeTool === 'text') && (
          <div className="flex flex-nowrap items-center gap-4 border-l border-dark-border pl-6 animate-in slide-in-from-left-2 fade-in shrink-0">
            {/* Color Picker */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase whitespace-nowrap">{t('editor.color')}</label>
              <div className="flex gap-1">
                {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ffffff', '#000000'].map(c => (
                  <button
                    key={c}
                    onClick={() => applyBrushColor(c)}
                    className={`w-5 h-5 rounded-full border border-white/20 transition-transform hover:scale-110 ${brushColor === c ? 'ring-2 ring-white scale-110' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              {/* Custom Color Input Hidden but accessible if needed */}
              <input type="color" value={brushColor} onChange={(e) => applyBrushColor(e.target.value)} className="w-0 h-0 opacity-0" id="color-input" />
              <label htmlFor="color-input" className="p-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer"><PaletteIcon /></label>
            </div>

            {activeTool === 'brush' && (
              <>
                <div className="w-px h-6 bg-dark-border" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 uppercase whitespace-nowrap">{t('editor.size')}</span>
                  <input
                    type="range" min="5" max="100"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-20 h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  />
                </div>
              </>
            )}
            {activeTool === 'text' && (
              <>
                <div className="w-px h-6 bg-dark-border" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 uppercase whitespace-nowrap">{t('editor.font_size')}</span>
                  <input
                    type="range"
                    min="12"
                    max="96"
                    value={textSize}
                    onChange={(e) => applyTextSize(parseInt(e.target.value, 10))}
                    className="w-20 h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={textSizeInput}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^0-9]/g, '');
                      setTextSizeInput(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => {
                      const nextValue = textSizeInput.trim();
                      if (nextValue.length === 0) {
                        setTextSizeInput(String(textSize));
                        return;
                      }
                      applyTextSize(Number(nextValue));
                    }}
                    className="w-12 h-6 bg-black/40 border border-white/10 rounded text-[10px] text-gray-200 text-center focus:outline-none focus:ring-1 focus:ring-brand-500/60"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Regions Panel */}
      <div className="absolute right-6 top-28 w-72 bg-dark-panel/95 border border-dark-border rounded-xl shadow-xl p-4 z-40">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-gray-400 uppercase">Regions</div>
          {activeRegionId && (
            <div className="text-[10px] text-brand-400 font-bold">Active #{activeRegionId}</div>
          )}
        </div>
        {regions.length === 0 ? (
          <div className="text-xs text-gray-500 leading-relaxed">
            Add a marker or draw to create an edit region.
          </div>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
            {regions.map(region => (
              <div key={region.id} className={`rounded-lg border p-2 ${activeRegionId === region.id ? 'border-brand-500/60 bg-white/5' : 'border-white/5'}`}>
                <button
                  onClick={() => handleSelectRegion(region.id)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ backgroundColor: region.color }}>
                    {region.id}
                  </span>
                  <span className="text-xs font-semibold text-gray-300">Region {region.id}</span>
                </button>
                <textarea
                  value={region.instruction}
                  onChange={(e) => updateRegionInstruction(region.id, e.target.value)}
                  placeholder={`Describe edit for region ${region.id}...`}
                  className="mt-2 w-full bg-black/30 border border-white/5 rounded-md p-2 text-[11px] text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/60"
                  rows={2}
                />
              </div>
            ))}
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
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onTouchStart={(e) => { lastMouseEventRef.current = e; startDrawing(e); }}
        onTouchMove={(e) => { lastMouseEventRef.current = e; draw(e); }}
        onTouchEnd={stopDrawing}
        onWheel={handleWheel}
        style={{
          cursor: isPanning
            ? 'grabbing'
            : activeTool === 'marker'
              ? MARKER_CURSOR
              : activeTool === 'text'
                ? isResizingText || textHoverState === 'handle' || isResizingEntry || entryHoverState === 'handle'
                  ? 'crosshair'
                  : textHoverState === 'body' || isDraggingText
                    ? 'move'
                    : 'text'
                : 'crosshair'
        }}
      >
        {textEntry && (
          <div
            className="absolute z-50"
            style={{
              left: textEntry.screenX,
              top: textEntry.screenY,
              width: textEntryOverlay?.width ?? textEntry.width + TEXT_BOX_PADDING * 2,
              height: textEntryOverlay?.height ?? textEntry.height + TEXT_BOX_PADDING * 2,
              cursor: isResizingEntry || entryHoverState === 'handle' ? 'crosshair' : 'text'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={handleTextEntryMouseUp}
            onClick={(e) => e.stopPropagation()}
            onMouseMove={handleTextEntryMouseMove}
            onMouseDownCapture={handleTextEntryMouseDown}
            onMouseLeave={handleTextEntryMouseLeave}
          >
            <div className="absolute inset-0 border border-dashed border-white/70 pointer-events-none" />
            <div
              className="absolute pointer-events-none"
              style={{
                width: textEntryOverlay?.handleSize ?? Math.max(10, textEntry.fontSize * 0.4),
                height: textEntryOverlay?.handleSize ?? Math.max(10, textEntry.fontSize * 0.4),
                right: 2,
                bottom: 2,
                border: '1px solid rgba(0,0,0,0.45)',
                background: 'rgba(255,255,255,0.9)'
              }}
            />
            <textarea
              ref={textInputRef}
              value={textEntry.value}
              onChange={(e) => {
                const value = e.target.value;
                const annotationCtx = annotationCanvasRef.current?.getContext('2d');
                setTextEntry(prev => {
                  if (!prev) return prev;
                  if (!annotationCtx) {
                    return { ...prev, value };
                  }
                  const layout = getTextLayout(annotationCtx, value, prev.fontSize, prev.width);
                  return {
                    ...prev,
                    value,
                    height: Math.max(prev.height, layout.height)
                  };
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleTextCommit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleTextCancel();
                }
              }}
              onBlur={handleTextCommit}
              className="absolute left-0 top-0 bg-transparent text-white focus:outline-none select-text"
              style={{
                width: textEntryOverlay?.inputWidth ?? textEntry.width,
                height: textEntryOverlay?.inputHeight ?? textEntry.height,
                transform: `translate(${textEntryOverlay?.paddingX ?? TEXT_BOX_PADDING}px, ${textEntryOverlay?.paddingY ?? TEXT_BOX_PADDING}px)`,
                fontSize: textEntryOverlay?.fontSize ?? textEntry.fontSize,
                color: textEntry.color,
                lineHeight: TEXT_LINE_HEIGHT,
                resize: 'none',
                overflow: 'hidden',
                wordBreak: 'break-word',
                padding: 0
              }}
              placeholder={t('editor.text_placeholder')}
              spellCheck={false}
            />
          </div>
        )}
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
            ref={maskPreviewCanvasRef}
            className="absolute inset-0 pointer-events-none" // Events handled by container
            style={{ width: '100%', height: '100%' }}
          />
          <canvas
            ref={markerCanvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
          />
          <canvas
            ref={annotationCanvasRef}
            className="absolute inset-0 pointer-events-none" // Events handled by container
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Toast Hint */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
          {(activeTool === 'marker' || activeTool === 'rect' || activeTool === 'arrow' || activeTool === 'text') && (
            <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-white border border-white/10">
              {activeTool === 'marker' && "Click objects to add numbered markers"}
              {activeTool === 'rect' && "Draw boxes to define numbered regions"}
              {activeTool === 'arrow' && "Drag to draw an arrow annotation"}
              {activeTool === 'text' && "Click to place text annotations"}
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
