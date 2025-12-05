
import React, { useState } from 'react';
import { Sun, Camera, Box, Move, ChevronDown, ChevronUp, Tag, Palette, Layers } from 'lucide-react';

interface PromptBuilderProps {
  onAppend: (text: string) => void;
}

const CATEGORIES = [
  {
    id: 'lighting',
    label: 'Lighting',
    icon: <Sun size={14} />,
    tags: ['Cinematic Lighting', 'Volumetric Fog', 'Golden Hour', 'Neon Lights', 'Rembrandt Lighting', 'Soft Studio Lighting', 'Bioluminescence', 'Dark Moody', 'God Rays', 'Rim Lighting']
  },
  {
    id: 'camera',
    label: 'Camera',
    icon: <Camera size={14} />,
    tags: ['Wide Angle', 'Macro Lens', 'Drone View', 'GoPro Footage', 'Bokeh Depth of Field', 'Fish-eye', 'Isometric View', 'Low Angle Shot', 'Telephoto', 'Motion Blur']
  },
  {
    id: 'material',
    label: 'Material',
    icon: <Box size={14} />,
    tags: ['Metallic', 'Translucent', 'Matte Finish', 'Hyper-realistic Skin', 'Glass Texture', 'Rough Concrete', 'Silk Fabric', 'Holographic', 'Iridescent', 'Liquid Chrome']
  },
  {
    id: 'style',
    label: 'Style',
    icon: <Palette size={14} />,
    tags: ['Minimalist', 'Abstract', 'Surrealism', 'Cyberpunk', 'Steampunk', 'Vaporwave', 'Gothic', 'Pop Art', 'Ukiyo-e', 'Noir']
  },
  {
    id: 'vibe',
    label: 'Vibe',
    icon: <Move size={14} />,
    tags: ['Chaos', 'Ethereal', 'Gritty', 'Dreamy', 'Epic Scale', 'Whimsical', 'Melancholic', 'Serene', 'Action Packed']
  }
];

export const PromptBuilder: React.FC<PromptBuilderProps> = ({ onAppend }) => {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const toggleCategory = (id: string) => {
    setActiveCategory(activeCategory === id ? null : id);
  };

  return (
    <div className="flex flex-col gap-2 mb-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-1">
         <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
           <Layers size={10} /> Prompt Builder
         </label>
         <span className="text-[10px] text-gray-600">Click to add</span>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar no-scrollbar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => toggleCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border shrink-0 ${
              activeCategory === cat.id
                ? 'bg-brand-500 text-white border-brand-500 shadow-lg shadow-brand-500/20'
                : 'bg-dark-surface text-gray-400 border-dark-border hover:border-gray-500 hover:text-gray-200'
            }`}
          >
            {cat.icon}
            {cat.label}
            {activeCategory === cat.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        ))}
      </div>

      {/* Tag Grid */}
      {activeCategory && (
        <div className="bg-dark-surface/50 border border-dark-border rounded-xl p-3 grid grid-cols-2 md:grid-cols-3 gap-2 animate-in zoom-in-95 duration-200">
           {CATEGORIES.find(c => c.id === activeCategory)?.tags.map(tag => (
             <button
               key={tag}
               onClick={() => onAppend(tag)}
               className="text-left text-xs text-gray-300 hover:text-brand-400 hover:bg-white/5 px-2 py-1.5 rounded transition-colors flex items-center gap-2 group"
             >
               <Tag size={10} className="text-gray-600 group-hover:text-brand-500" />
               {tag}
             </button>
           ))}
        </div>
      )}
    </div>
  );
};
