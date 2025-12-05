
import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'zh';

const translations = {
  en: {
    // Nav & Sidebar
    'nav.projects': 'Projects',
    'nav.image': 'Image',
    'nav.video': 'Video',
    'nav.trash': 'Trash',
    'nav.settings': 'Settings',
    'nav.new_project': 'New Project',
    'nav.generating': 'Generating...',
    'nav.delete_confirm': 'Are you sure you want to delete this project?',
    'nav.delete_error': 'Cannot delete a project while it is generating.',
    
    // Headers
    'header.compare': 'Compare',
    'header.favorites': 'Favorites',
    'header.assets': 'Assets',
    'header.selected': 'Selected',
    'header.trash': 'Recycle Bin',
    'header.trash_count': 'Items',
    
    // Form - Tabs
    'tab.parameters': 'Parameters',
    'tab.assistant': 'Assistant',
    
    // Form - Inputs
    'lbl.model': 'Model',
    'lbl.prompt': 'Prompt Text',
    'lbl.negative_prompt': 'Negative Prompt',
    'lbl.seed': 'Seed',
    'lbl.aspect_ratio': 'Aspect Ratio',
    'lbl.resolution': 'Resolution',
    'lbl.count': 'Count',
    'lbl.duration': 'Duration',
    'lbl.style': 'Style',
    'lbl.advanced': 'Advanced Settings',
    
    // Visual Control Center Labels
    'lbl.subject_ref': 'Subject / Identity',
    'lbl.comp_ref': 'Base Image / Composition',
    'lbl.style_ref': 'Style / Vibe',
    'lbl.video_keyframes': 'Video Keyframes (Optional)',
    'lbl.video_extend': 'Extend Video',
    'lbl.continuous_mode': 'Continuous Mode',
    'lbl.text_render': 'Text to Render',
    
    // Subject Types
    'subj.person': 'Person',
    'subj.animal': 'Animal',
    'subj.object': 'Object',
    
    // Form - Placeholders & Help
    'ph.prompt.image': 'Describe the image you want to generate...',
    'ph.prompt.video': 'Describe the video you want to generate...',
    'ph.negative': 'e.g. blurry, low quality, text...',
    'ph.seed_random': 'Random (-1)',
    'ph.text_render': 'e.g. Hello World',
    'help.continuous': 'Auto-use result as next Composition Reference',
    'help.upload': 'Click to upload',
    'help.extend_desc': 'Upload a video to extend it by 5-7 seconds. Resolution will be set to 720p.',
    
    // Detailed Explanations
    'help.subject_desc': 'Defines "WHO/WHAT". Keeps facial features, product details, or character identity consistent.',
    'help.comp_desc': 'Defines "WHERE/HOW". Keeps the pose, layout, depth, and structure of the scene.',
    'help.style_desc': 'Defines "ART STYLE". Extracts colors, lighting, texture, and brush strokes.',
    
    'help.video_frames': 'Define the start or end of your video (optional).',
    
    // Actions
    'btn.generate': 'Generate',
    'btn.queue': 'Add to Queue',
    'btn.analyzing': 'Analyzing Chat...',
    'btn.magic_enhance': 'Magic Enhance',
    'btn.describe': 'Describe Image',
    'btn.download': 'Download',
    'btn.delete': 'Delete',
    'btn.use_ref': 'Use as Ref',
    'btn.verify': 'Verify Paid Account',
    'btn.save_key': 'Save Key',
    'btn.remove_key': 'Remove Key',
    'btn.test_connection': 'Test',
    'btn.restore': 'Restore',
    'btn.delete_forever': 'Delete Forever',
    'btn.empty_trash': 'Empty Trash',
    'btn.extend': 'Extend',
    
    // Confirmation
    'confirm.delete.title': 'Move to Recycle Bin?',
    'confirm.delete.desc': 'This item will be moved to the Recycle Bin. You can restore it later.',
    'confirm.empty_trash.title': 'Empty Recycle Bin?',
    'confirm.empty_trash.desc': 'This will permanently delete all items in the trash. This action cannot be undone.',
    'confirm.delete_forever.title': 'Delete Permanently?',
    'confirm.delete_forever.desc': 'This action cannot be undone.',
    'btn.cancel': 'Cancel',
    'btn.confirm': 'Confirm',
    
    // Models & Styles (Display Names)
    'model.flash': 'Nano Banana',
    'model.pro': 'Nano Banana Pro',
    'model.veo_fast': 'Veo Fast (Preview)',
    'model.veo_hq': 'Veo High Quality (Pro)',
    
    // Messages
    'msg.no_assets': 'No assets yet',
    'msg.no_trash': 'Recycle Bin is empty',
    'msg.generate_something': 'Generate something amazing!',
    'msg.cost_warning': 'Generations cost tokens. Check Google AI Studio for pricing.',
    'msg.connection_success': 'Connection Successful!',
    'msg.connection_failed': 'Connection Failed',
  },
  zh: {
    // Nav & Sidebar
    'nav.projects': '项目列表',
    'nav.image': '图像生成',
    'nav.video': '视频生成',
    'nav.trash': '回收站',
    'nav.settings': '设置',
    'nav.new_project': '新建项目',
    'nav.generating': '生成中...',
    'nav.delete_confirm': '确定要删除此项目吗？',
    'nav.delete_error': '无法删除正在生成的项目。',
    
    // Headers
    'header.compare': '对比',
    'header.favorites': '收藏',
    'header.assets': '个资源',
    'header.selected': '已选择',
    'header.trash': '回收站',
    'header.trash_count': '项',
    
    // Form - Tabs
    'tab.parameters': '参数配置',
    'tab.assistant': 'AI 助手',
    
    // Form - Inputs
    'lbl.model': '模型选择',
    'lbl.prompt': '提示词 (Prompt)',
    'lbl.negative_prompt': '反向提示词 (Negative)',
    'lbl.seed': '随机种子 (Seed)',
    'lbl.aspect_ratio': '画面比例',
    'lbl.resolution': '分辨率',
    'lbl.count': '数量',
    'lbl.duration': '时长',
    'lbl.style': '艺术风格',
    'lbl.advanced': '高级设置',
    
    // Visual Control Center Labels
    'lbl.subject_ref': '主体 / 角色参考',
    'lbl.comp_ref': '垫图 / 构图参考',
    'lbl.style_ref': '风格参考 / 滤镜',
    'lbl.video_keyframes': '视频关键帧 (可选)',
    'lbl.video_extend': '视频扩充 (Extend)',
    'lbl.continuous_mode': '连续模式',
    'lbl.text_render': '画面文字 (Text)',
    
    // Subject Types
    'subj.person': '人物',
    'subj.animal': '动物',
    'subj.object': '物体',
    
    // Form - Placeholders & Help
    'ph.prompt.image': '描述你想生成的画面...',
    'ph.prompt.video': '描述你想生成的视频内容...',
    'ph.negative': '例如：模糊、低质量、水印...',
    'ph.seed_random': '随机 (-1)',
    'ph.text_render': '例如：Happy Birthday',
    'help.continuous': '自动将生成结果作为下一张的构图参考',
    'help.upload': '点击上传',
    'help.extend_desc': '上传视频进行内容续写 (扩充 5-7秒)。注意：分辨率将锁定为 720p。',
    
    // Detailed Explanations
    'help.subject_desc': '决定“是谁/画什么”。保持面部特征、产品细节或角色身份的一致性。',
    'help.comp_desc': '决定“在哪/怎么摆”。保持画面的构图、姿势、深度和结构。',
    'help.style_desc': '决定“画风/色调”。提取图片的色彩、光影、纹理和笔触。',
    
    'help.video_frames': '定义视频的起始或结束画面（可选）。',
    
    // Actions
    'btn.generate': '开始生成',
    'btn.queue': '加入队列',
    'btn.analyzing': '分析对话中...',
    'btn.magic_enhance': '魔法优化',
    'btn.describe': '图片反推',
    'btn.download': '下载',
    'btn.delete': '删除',
    'btn.use_ref': '设为参考图',
    'btn.verify': '验证付费账户',
    'btn.save_key': '保存密钥',
    'btn.remove_key': '移除密钥',
    'btn.test_connection': '测试连接',
    'btn.restore': '恢复',
    'btn.delete_forever': '彻底删除',
    'btn.empty_trash': '清空回收站',
    'btn.extend': '续写视频',
    
    // Confirmation
    'confirm.delete.title': '移入回收站?',
    'confirm.delete.desc': '该资源将被移入回收站，你可以随时恢复它。',
    'confirm.empty_trash.title': '清空回收站?',
    'confirm.empty_trash.desc': '将永久删除回收站中的所有项目。此操作无法撤销。',
    'confirm.delete_forever.title': '彻底删除?',
    'confirm.delete_forever.desc': '此操作无法撤销。',
    'btn.cancel': '取消',
    'btn.confirm': '确认',
    
    // Models & Styles (Display Names)
    'model.flash': 'Nano Banana',
    'model.pro': 'Nano Banana Pro',
    'model.veo_fast': 'Veo Fast (快速预览)',
    'model.veo_hq': 'Veo High Quality (高质量)',
    
    // Messages
    'msg.no_assets': '暂无资源',
    'msg.no_trash': '回收站为空',
    'msg.generate_something': '开始创造惊艳的作品吧！',
    'msg.cost_warning': '生成消耗 Token，具体定价请查看 Google AI Studio。',
    'msg.connection_success': '连接成功！网络畅通。',
    'msg.connection_failed': '连接失败',
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('app_language') as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'zh')) {
      setLanguage(savedLang);
    }
  }, []);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: keyof typeof translations['en']) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
