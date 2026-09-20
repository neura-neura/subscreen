export type AppLocale = 'en' | 'es' | 'zh';

export const appLocaleOptions: Array<{ value: AppLocale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'zh', label: '中文' },
];

const messages = {
  en: {
    themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    dropTitle: 'Drop a video to get started', dropDescription: 'Detect burned-in subtitles, refine the SRT, then export it or permanently embed it in your video.', chooseFile: 'Choose file', formats: 'MP4 · MKV · MOV · AVI · WEBM and more', basedOn: 'Based on Noir Player playback and FFmpeg export workflow.',
    loadedVideo: 'Video loaded', importSrt: 'Import subtitles', exportSrt: 'Export SRT', burnVideo: 'Burn video', back: 'Back',
    workflow: 'Workflow', workflowDescription: 'Mark the area and detect each appearance.', videoLoaded: '1. Video loaded', subtitleArea: '2. Subtitle area', reviewExport: '3. Review and export', areaSelected: 'Area selected', areaPending: 'Waiting to be marked', cuesReady: '{{count}} cues ready', noCues: 'No subtitles yet',
    ocrLanguage: 'OCR language', ocrDescription: 'Automatic detects Chinese script; otherwise it uses installed Latin models.', automatic: 'Automatic · installed models', installFirst: ' · install first', installed: 'Installed', install: 'Install',
    howItWorks: 'How it works', howOne: 'Select only the rectangle containing subtitles.', howTwo: 'OCR groups consecutive appearances into SRT cues.', howThree: 'Edit text and timings while previewing them.',
    ocrArea: 'OCR AREA', selectArea: 'Select area', changeArea: 'Change area', areaSize: '{{width}} × {{height}}% of frame', analyze: 'Analyze subtitles', analyzing: 'Analyzing…', selectHint: 'Drag over subtitles · player controls are excluded',
    actions: 'Actions', import: 'Import', logs: 'Live logs', events: '{{count}} events', copy: 'Copy', editor: 'Subtitle editor', previewActive: '{{count}} cues · preview active', cuesWillAppear: 'Cues will appear here', addSubtitle: 'Add subtitle', exportFile: 'Export SRT file', embedVideo: 'Embed subtitles into video',
    noSubtitles: 'No subtitles yet', noSubtitlesDescription: 'Select an area and run analysis, or import an existing SRT.', createManually: 'Create manually', goToCue: 'Go to cue', deleteCue: 'Delete cue', newSubtitle: 'New subtitle',
    dragDropError: 'Drop a video or an SRT, VTT, ASS, SSA or ZIP file.', videoLoadedNotice: 'Video loaded. Select the area where subtitles appear.', imported: '{{count}} subtitles imported from {{name}}.', invalidCues: 'No valid cues were found in that file.', areaTooSmall: 'The area is too small. Try again.', areaReady: 'Area selected. You can now analyze the video.', analysisRequested: 'Analysis requested from the interface.', analyzingFrames: 'Extracting and reading frames from the selected area…', analysisDone: 'Analysis finished: {{count}} subtitles detected.', noText: 'No text was detected. Check the area or the Ollama / GLM-OCR installation.', saved: 'SRT saved as {{name}}.', burning: 'FFmpeg is embedding subtitles into the video…', exportedVideo: 'Video exported: {{name}}.', logsCopied: 'Logs copied to clipboard.', logsCopyError: 'Could not copy logs.', languageSelected: 'OCR language selected: {{language}}.', modelAvailable: '{{language}} is now available for OCR.',
  },
  es: {
    themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Oscuro',
    dropTitle: 'Suelta un video para empezar', dropDescription: 'Detecta subtítulos quemados, corrige el SRT y expórtalo o intégralo permanentemente al video.', chooseFile: 'Elegir archivo', formats: 'MP4 · MKV · MOV · AVI · WEBM y más', basedOn: 'Basado en el flujo de reproducción de Noir Player y exportación FFmpeg.',
    loadedVideo: 'Video cargado', importSrt: 'Importar subtítulos', exportSrt: 'Exportar SRT', burnVideo: 'Burnear video', back: 'Volver',
    workflow: 'Flujo de trabajo', workflowDescription: 'Marca la zona y detecta cada aparición.', videoLoaded: '1. Video cargado', subtitleArea: '2. Área de subtítulos', reviewExport: '3. Revisar y exportar', areaSelected: 'Área seleccionada', areaPending: 'Pendiente de marcar', cuesReady: '{{count}} cues listos', noCues: 'Aún sin subtítulos',
    ocrLanguage: 'Idioma OCR', ocrDescription: 'Automático detecta escritura china; el resto usa los modelos latinos instalados.', automatic: 'Automático · modelos instalados', installFirst: ' · instalar primero', installed: 'Instalado', install: 'Instalar',
    howItWorks: 'Cómo funciona', howOne: 'Selecciona solo el rectángulo que contiene los subtítulos.', howTwo: 'El OCR agrupa las apariciones consecutivas en cues SRT.', howThree: 'Corrige texto y tiempos mientras los previsualizas.',
    ocrArea: 'ÁREA OCR', selectArea: 'Seleccionar área', changeArea: 'Cambiar área', areaSize: '{{width}} × {{height}}% del cuadro', analyze: 'Analizar subtítulos', analyzing: 'Analizando…', selectHint: 'Arrastra sobre los subtítulos · los controles quedan excluidos',
    actions: 'Acciones', import: 'Importar', logs: 'Logs en tiempo real', events: '{{count}} eventos', copy: 'Copiar', editor: 'Editor de subtítulos', previewActive: '{{count}} cues · vista previa activa', cuesWillAppear: 'Los cues aparecerán aquí', addSubtitle: 'Añadir subtítulo', exportFile: 'Exportar archivo SRT', embedVideo: 'Integrar subtítulos al video',
    noSubtitles: 'Aún no hay subtítulos', noSubtitlesDescription: 'Selecciona el área y ejecuta el análisis, o importa un SRT ya existente.', createManually: 'Crear manualmente', goToCue: 'Ir al cue', deleteCue: 'Eliminar cue', newSubtitle: 'Nuevo subtítulo',
    dragDropError: 'Suelta un video o un archivo SRT, VTT, ASS, SSA o ZIP.', videoLoadedNotice: 'Video cargado. Selecciona el área donde aparecen los subtítulos.', imported: '{{count}} subtítulos importados desde {{name}}.', invalidCues: 'No encontré cues válidos en ese archivo.', areaTooSmall: 'El área es muy pequeña. Intenta de nuevo.', areaReady: 'Área seleccionada. Ahora puedes analizar el video.', analysisRequested: 'Análisis solicitado desde la interfaz.', analyzingFrames: 'Extrayendo y leyendo cuadros del área seleccionada…', analysisDone: 'Análisis terminado: {{count}} subtítulos detectados.', noText: 'No se detectó texto. Revisa el área o la instalación de Ollama / GLM-OCR.', saved: 'SRT guardado en {{name}}.', burning: 'FFmpeg está incrustando los subtítulos en el video…', exportedVideo: 'Video exportado: {{name}}.', logsCopied: 'Logs copiados al portapapeles.', logsCopyError: 'No se pudieron copiar los logs.', languageSelected: 'Idioma OCR seleccionado: {{language}}.', modelAvailable: '{{language}} ya está disponible para OCR.',
  },
  zh: {
    themeSystem: '跟随系统', themeLight: '浅色', themeDark: '深色',
    dropTitle: '拖放视频以开始', dropDescription: '检测硬字幕，编辑 SRT，然后导出或永久嵌入视频。', chooseFile: '选择文件', formats: 'MP4 · MKV · MOV · AVI · WEBM 等', basedOn: '基于 Noir Player 播放与 FFmpeg 导出流程。',
    loadedVideo: '已加载视频', importSrt: '导入 SRT', exportSrt: '导出 SRT', burnVideo: '烧录视频', back: '返回',
    workflow: '工作流程', workflowDescription: '标记区域并检测每次字幕出现。', videoLoaded: '1. 已加载视频', subtitleArea: '2. 字幕区域', reviewExport: '3. 检查并导出', areaSelected: '已选择区域', areaPending: '等待标记', cuesReady: '已准备 {{count}} 条字幕', noCues: '尚无字幕',
    ocrLanguage: 'OCR 语言', ocrDescription: '自动模式会检测中文；其他情况使用已安装的拉丁语模型。', automatic: '自动 · 已安装模型', installFirst: ' · 请先安装', installed: '已安装', install: '安装',
    howItWorks: '使用方法', howOne: '只选择包含字幕的矩形区域。', howTwo: 'OCR 将连续出现的文本组合成 SRT 字幕。', howThree: '在预览时编辑文字与时间。',
    ocrArea: 'OCR 区域', selectArea: '选择区域', changeArea: '更改区域', areaSize: '画面的 {{width}} × {{height}}%', analyze: '分析字幕', analyzing: '正在分析…', selectHint: '在字幕上拖动 · 已排除播放器控件',
    actions: '操作', import: '导入', logs: '实时日志', events: '{{count}} 个事件', copy: '复制', editor: '字幕编辑器', previewActive: '{{count}} 条字幕 · 预览已启用', cuesWillAppear: '字幕将显示在这里', addSubtitle: '添加字幕', exportFile: '导出 SRT 文件', embedVideo: '将字幕嵌入视频',
    noSubtitles: '尚无字幕', noSubtitlesDescription: '选择区域并运行分析，或导入已有 SRT。', createManually: '手动创建', goToCue: '跳转到字幕', deleteCue: '删除字幕', newSubtitle: '新字幕',
    dragDropError: '请拖入视频或 .srt、.vtt 文件。', videoLoadedNotice: '视频已加载。请选择字幕所在区域。', imported: '已从 {{name}} 导入 {{count}} 条字幕。', invalidCues: '该文件中没有有效字幕。', areaTooSmall: '区域太小，请重试。', areaReady: '区域已选择，现在可以分析视频。', analysisRequested: '已从界面请求分析。', analyzingFrames: '正在提取和读取所选区域的帧…', analysisDone: '分析完成：检测到 {{count}} 条字幕。', noText: '未检测到文字。请检查区域或 Ollama / GLM-OCR 安装。', saved: 'SRT 已保存为 {{name}}。', burning: 'FFmpeg 正在将字幕嵌入视频…', exportedVideo: '视频已导出：{{name}}。', logsCopied: '日志已复制到剪贴板。', logsCopyError: '无法复制日志。', languageSelected: '已选择 OCR 语言：{{language}}。', modelAvailable: '{{language}} 已可用于 OCR。',
  },
} as const;

export type TranslationKey = keyof typeof messages.en;

export function translate(locale: AppLocale, key: TranslationKey, values: Record<string, string | number> = {}) {
  let message: string = messages[locale][key] ?? messages.en[key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{{${name}}}`, String(value));
  }
  return message;
}
