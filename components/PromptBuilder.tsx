
import React, { useState } from 'react';
import { Sun, Camera, Box, Move, ChevronDown, ChevronUp, Tag, Palette, Layers, Video, Zap, Aperture, X } from 'lucide-react';
import { AppMode } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface PromptBuilderProps {
  selectedTags: string[];
  onToggleTag: (tagKey: string) => void;
  onClearTags: () => void;
  mode?: AppMode;
}

export const PromptBuilder: React.FC<PromptBuilderProps> = ({ selectedTags, onToggleTag, onClearTags, mode = AppMode.IMAGE }) => {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const IMAGE_CATEGORIES = [
    {
      id: 'lighting',
      label: t('builder.lighting'),
      icon: <Sun size={14} />,
      tags: [
        'bt.cinematic_lighting', 'bt.volumetric_fog', 'bt.golden_hour',
        'bt.neon_lights', 'bt.rembrandt', 'bt.soft_studio',
        'bt.bioluminescence', 'bt.dark_moody', 'bt.god_rays', 'bt.rim_lighting'
      ]
    },
    {
      id: 'camera',
      label: t('builder.camera'),
      icon: <Camera size={14} />,
      tags: [
        'bt.wide_angle', 'bt.macro_lens', 'bt.drone_view', 'bt.gopro',
        'bt.bokeh', 'bt.fisheye', 'bt.isometric', 'bt.low_angle',
        'bt.telephoto', 'bt.motion_blur'
      ]
    },
    {
      id: 'material',
      label: t('builder.material'),
      icon: <Box size={14} />,
      tags: [
        'bt.metallic', 'bt.translucent', 'bt.matte', 'bt.skin',
        'bt.glass', 'bt.concrete', 'bt.silk', 'bt.holographic',
        'bt.iridescent', 'bt.liquid_chrome'
      ]
    },
    {
      id: 'style',
      label: t('builder.style'),
      icon: <Palette size={14} />,
      tags: [
        'bt.minimalist', 'bt.abstract', 'bt.surrealism', 'bt.cyberpunk',
        'bt.steampunk', 'bt.vaporwave', 'bt.gothic', 'bt.pop_art',
        'bt.ukiyo_e', 'bt.noir'
      ]
    },
    {
      id: 'vibe',
      label: t('builder.vibe'),
      icon: <Move size={14} />,
      tags: [
        'bt.chaos', 'bt.ethereal', 'bt.gritty', 'bt.dreamy', 'bt.epic_scale',
        'bt.whimsical', 'bt.melancholic', 'bt.serene', 'bt.action_packed'
      ]
    }
  ];

  const VIDEO_CATEGORIES = [
    {
      id: 'camera_move',
      label: t('builder.camera_move'),
      icon: <Video size={14} />,
      tags: [
        'bt.drone_shot', 'bt.pan_left', 'bt.pan_right', 'bt.tilt_up',
        'bt.tilt_down', 'bt.dolly_in', 'bt.dolly_out', 'bt.tracking_shot',
        'bt.handheld', 'bt.fpv', 'bt.worms_eye'
      ]
    },
    {
      id: 'motion',
      label: t('builder.motion'),
      icon: <Zap size={14} />,
      tags: [
        'bt.slow_motion', 'bt.time_lapse', 'bt.hyper_lapse', 'bt.high_speed',
        'bt.static_cam', 'bt.freeze_frame', 'bt.loop', 'bt.fluid_motion',
        'bt.explosive'
      ]
    },
    {
      id: 'atmosphere',
      label: t('builder.atmosphere'),
      icon: <Sun size={14} />,
      tags: [
        'bt.vintage_film', 'bt.foggy', 'bt.rainy', 'bt.sunny',
        'bt.night_city', 'bt.underwater', 'bt.dusty', 'bt.scifi_clean',
        'bt.horror'
      ]
    },
    {
      id: 'lens',
      label: t('builder.lens'),
      icon: <Aperture size={14} />,
      tags: [
        'bt.shallow_dof', 'bt.deep_focus', 'bt.rack_focus', 'bt.macro_cu',
        'bt.wide_angle_lens', 'bt.telephoto_lens', 'bt.fisheye_lens', 'bt.anamorphic'
      ]
    }
  ];

  const categories = mode === AppMode.VIDEO ? VIDEO_CATEGORIES : IMAGE_CATEGORIES;

  const toggleCategory = (id: string) => {
    setActiveCategory(activeCategory === id ? null : id);
  };

  const isTagSelected = (tagKey: string) => selectedTags.includes(tagKey);

  return (
    <div className="flex flex-col gap-2 mb-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
          <Layers size={10} /> Prompt Builder
        </label>
        {selectedTags.length > 0 && (
          <button onClick={onClearTags} className="text-[10px] text-gray-500 hover:text-white transition-colors">
            {t('builder.clear_all')}
          </button>
        )}
      </div>

      {/* Selected Tags Pills */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedTags.map(tagKey => (
            <button
              key={tagKey}
              onClick={() => onToggleTag(tagKey)}
              className="flex items-center gap-1 px-2 py-1 bg-brand-500/20 text-brand-400 border border-brand-500/50 rounded-full text-[10px] font-medium hover:bg-brand-500/30 transition-colors group"
            >
              <span>{t(tagKey as any)}</span>
              <X size={10} className="opacity-60 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar no-scrollbar">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => toggleCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border shrink-0 ${activeCategory === cat.id
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
        <div className="bg-dark-surface/50 border border-dark-border rounded-xl p-3 grid grid-cols-2 md:grid-cols-3 gap-2 animate-in zoom-in-95 duration-200 max-h-48 overflow-y-auto custom-scrollbar">
          {categories.find(c => c.id === activeCategory)?.tags.map(tagKey => (
            <button
              key={tagKey}
              onClick={() => onToggleTag(tagKey)}
              className={`text-left text-xs px-2 py-1.5 rounded transition-colors flex items-center gap-2 group ${isTagSelected(tagKey)
                ? 'bg-brand-500/20 text-brand-400 border border-brand-500/50'
                : 'text-gray-300 hover:text-brand-400 hover:bg-white/5'
                }`}
            >
              <Tag size={10} className={isTagSelected(tagKey) ? 'text-brand-500' : 'text-gray-600 group-hover:text-brand-500'} />
              <span className="truncate">{t(tagKey as any)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
