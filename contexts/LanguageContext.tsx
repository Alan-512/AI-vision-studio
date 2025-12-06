
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
    'lbl.video_controls': 'Video Controls',
    
    // Visual Control Center Labels
    'lbl.subject_ref': 'Subject / Identity',
    'lbl.comp_ref': 'Base Image / Composition',
    'lbl.style_ref': 'Style / Vibe',
    'lbl.video_keyframes': 'Keyframes',
    'lbl.video_subject_ref': 'Subject / Character Ref',
    'lbl.video_extend': 'Extend Video',
    'lbl.continuous_mode': 'Continuous Mode',
    'lbl.text_render': 'Text to Render',
    'lbl.locked_subject': 'Locked (Subject Ref)',
    
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
    'help.video_subject_desc': 'Upload images (max 3) to preserve the identity of a person, character, or object in the video.',
    'note.video_ref_limit': 'Note: Subject references lock resolution to 720p.',
    
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
    
    // Models
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

    // --- NEW SECTIONS ---

    // Settings
    'settings.title': 'Settings',
    'settings.key_label': 'Google AI Studio API Key',
    'settings.key_desc': 'Your API key is stored locally in your browser and used directly for requests. This allows you to bypass the shared quota and use your own billing account for Pro/Veo models.',
    'settings.get_key': 'Get an API Key',
    'settings.custom_key_alert': 'You are currently using your custom API Key. Remove it to revert to the system default key.',
    'settings.storage_title': 'Browser Storage Usage',
    'settings.storage_full': 'Storage is getting full. Please delete old projects to avoid data loss.',
    'settings.calculating': 'Calculating storage...',
    'settings.used': 'Used',
    'settings.free': 'Free',
    
    // Chat
    'chat.placeholder': 'Ask assistant...',
    'chat.welcome_video': 'Video Assistant',
    'chat.welcome_image': 'Creative Assistant',
    'chat.desc_video': 'Brainstorm scenes, camera angles, and motion ideas for your video generation.',
    'chat.desc_image': 'Discuss composition, style, and details to craft the perfect image prompt.',
    'chat.thinking': 'Thinking Process',
    'chat.copied': 'Copied',
    'chat.stop': 'Stop Generation',
    'chat.tools': 'Tools',
    'chat.upload': 'Upload Image',
    
    // Canvas
    'editor.title': 'Editor & Inpainting',
    'editor.desc': 'Draw masks or boxes to guide the AI',
    'editor.brush': 'Brush',
    'editor.box': 'Box',
    'editor.size': 'Size',
    'editor.use': 'Use Image',
    'editor.reset': 'Reset All',
    'editor.undo': 'Undo',
    'editor.cancel': 'Cancel',
    
    // Comparison
    'compare.title': 'Comparison View',
    'compare.vs': 'vs',
    
    // Task Center
    'task.center': 'Task Center',
    'task.active': 'Active Tasks',
    'task.complete': 'Tasks Complete',
    'task.failed': 'Generation Failed',
    'task.processing': 'Processing...',
    'task.queued': 'Queued',
    'task.clear': 'Clear Done',
    'task.waiting': 'Waiting for slot...',
    'task.running': 'Running',
    
    // Styles (Enum Keys)
    'style.NONE': 'None',
    'style.MODERN_VECTOR': 'Modern Flat Vector',
    'style.PHOTOREALISTIC': 'Photorealistic',
    'style.ANIME': 'Anime & Manga',
    'style.DIGITAL_ART': 'Digital Art',
    'style.COMIC_BOOK': 'Comic Book',
    'style.WATERCOLOR': 'Watercolor',
    'style.THREE_D_RENDER': '3D Render',
    'style.CYBERPUNK': 'Cyberpunk',
    'style.PIXEL_ART': 'Pixel Art',
    'style.SKETCH': 'Sketch / Pencil',
    'style.CINEMATIC': 'Cinematic',
    'style.VINTAGE': 'Vintage Film',
    'style.NATURE': 'Nature Documentary',
    'style.DRONE': 'Drone Footage',
    'style.GLITCH': 'Glitch Art',
    'style.THREE_D': '3D Animation',
    
    // Ratios (Enum Keys)
    'ratio.SQUARE': 'Square (1:1)',
    'ratio.LANDSCAPE': 'Landscape (16:9)',
    'ratio.PORTRAIT': 'Portrait (9:16)',
    'ratio.FOUR_THIRDS': 'Landscape (4:3)',
    'ratio.THREE_FOURTHS': 'Portrait (3:4)',
    
    // Builder Categories
    'builder.lighting': 'Lighting',
    'builder.camera': 'Camera',
    'builder.material': 'Material',
    'builder.style': 'Style',
    'builder.vibe': 'Vibe',
    'builder.camera_move': 'Camera Move',
    'builder.motion': 'Motion',
    'builder.atmosphere': 'Atmosphere',
    'builder.lens': 'Lens/Focus',
    
    // Templates
    'tmpl.select': 'Select Template',
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
    'lbl.video_controls': '视频控制',
    
    // Visual Control Center Labels
    'lbl.subject_ref': '主体 / 角色参考',
    'lbl.comp_ref': '垫图 / 构图参考',
    'lbl.style_ref': '风格参考 / 滤镜',
    'lbl.video_keyframes': '关键帧控制',
    'lbl.video_subject_ref': '主体 / 角色参考',
    'lbl.video_extend': '视频续写 (Extension)',
    'lbl.continuous_mode': '连续模式',
    'lbl.text_render': '画面文字 (Text)',
    'lbl.locked_subject': '已锁定 (角色参考)',
    
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
    'help.video_subject_desc': '上传图片 (最多3张) 以在视频中保持人物、角色或物体的一致性。',
    'note.video_ref_limit': '注意：使用角色参考会将分辨率锁定为 720p。',
    
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
    
    // Models
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

    // --- NEW SECTIONS ZH ---

    // Settings
    'settings.title': '设置',
    'settings.key_label': 'Google AI Studio API Key',
    'settings.key_desc': '您的 API 密钥存储在本地浏览器中，直接用于请求。这允许您绕过共享配额，使用自己的计费账户来调用 Pro/Veo 模型。',
    'settings.get_key': '获取 API Key',
    'settings.custom_key_alert': '您当前正在使用自定义 API Key。移除它以恢复使用系统默认 Key。',
    'settings.storage_title': '浏览器存储使用情况',
    'settings.storage_full': '存储空间即将耗尽。请删除旧项目以避免数据丢失。',
    'settings.calculating': '正在计算存储...',
    'settings.used': '已用',
    'settings.free': '剩余',
    
    // Chat
    'chat.placeholder': '询问 AI 助手...',
    'chat.welcome_video': '视频创意助手',
    'chat.welcome_image': '创意设计助手',
    'chat.desc_video': '为您的视频生成构思场景、运镜角度和动态效果。',
    'chat.desc_image': '讨论构图、风格和细节，打造完美的图像提示词。',
    'chat.thinking': '思考过程',
    'chat.copied': '已复制',
    'chat.stop': '停止生成',
    'chat.tools': '工具',
    'chat.upload': '上传图片',
    
    // Canvas
    'editor.title': '编辑与重绘',
    'editor.desc': '绘制遮罩或框选以引导 AI',
    'editor.brush': '画笔',
    'editor.box': '矩形框',
    'editor.size': '大小',
    'editor.use': '使用图片',
    'editor.reset': '重置',
    'editor.undo': '撤销',
    'editor.cancel': '取消',
    
    // Comparison
    'compare.title': '对比视图',
    'compare.vs': '对比',
    
    // Task Center
    'task.center': '任务中心',
    'task.active': '个进行中任务',
    'task.complete': '任务已完成',
    'task.failed': '生成失败',
    'task.processing': '处理中...',
    'task.queued': '排队中',
    'task.clear': '清除已完成',
    'task.waiting': '等待队列...',
    'task.running': '运行中',
    
    // Styles (Enum Keys)
    'style.NONE': '无',
    'style.MODERN_VECTOR': '现代扁平矢量',
    'style.PHOTOREALISTIC': '写实摄影',
    'style.ANIME': '动漫 & 漫画',
    'style.DIGITAL_ART': '数字艺术',
    'style.COMIC_BOOK': '美漫风格',
    'style.WATERCOLOR': '水彩画',
    'style.THREE_D_RENDER': '3D 渲染',
    'style.CYBERPUNK': '赛博朋克',
    'style.PIXEL_ART': '像素艺术',
    'style.SKETCH': '素描 / 铅笔',
    'style.CINEMATIC': '电影感',
    'style.VINTAGE': '复古胶片',
    'style.NATURE': '自然纪录片',
    'style.DRONE': '无人机航拍',
    'style.GLITCH': '故障艺术',
    'style.THREE_D': '3D 动画',
    
    // Ratios (Enum Keys)
    'ratio.SQUARE': '正方形 (1:1)',
    'ratio.LANDSCAPE': '横屏 (16:9)',
    'ratio.PORTRAIT': '竖屏 (9:16)',
    'ratio.FOUR_THIRDS': '横屏 (4:3)',
    'ratio.THREE_FOURTHS': '竖屏 (3:4)',
    
    // Builder Categories
    'builder.lighting': '光影',
    'builder.camera': '运镜/视角',
    'builder.material': '材质',
    'builder.style': '风格',
    'builder.vibe': '氛围',
    'builder.camera_move': '运镜',
    'builder.motion': '动态',
    'builder.atmosphere': '环境',
    'builder.lens': '镜头/焦距',
    
    // Templates
    'tmpl.select': '选择模版',
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
    // @ts-ignore
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
