/**
 * 🔮 快乐少儿考试本 · 纯前端 PDF 魔法异步解析渲染引擎
 * 
 * 职责：
 * 1. 动态按需加载 CDN 上的 PDF.js 库与 Worker (避免本地打包包体积爆炸)
 * 2. 将上传的 PDF 文件读取为 ArrayBuffer
 * 3. 使用离屏 Canvas 按照清晰的 1.5 倍分辨率渲染每一页，输出高清的 Base64 PNG 图片集合
 */

// 声明外部 pdfjs 全局变量定义，规避 TypeScript 严格类型报错
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

/**
 * 动态注入脚本的辅助 Promise
 */
const loadScript = (url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    // 若已存在，直接 resolve
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
};

/**
 * 确保 PDF.js SDK 完全载入的守护函数
 */
const ensurePdfJsLoaded = async (): Promise<any> => {
  if (window.pdfjsLib) {
    return window.pdfjsLib;
  }

  // 1. 注入 PDF.js 主脚本
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');

  // 2. 配置 Worker 的 CDN 地址，确保多线程渲染机制可用
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  throw new Error('PDF.js SDK 动态载入失败，请检查网络连接 🌐');
};

/**
 * 魔法函数：将 PDF 文件极速转换为 Base64 PNG 图片流数组
 * @param file 老师上传的 File 对象
 * @param onProgress 可选的页进度加载回调，用于提升情绪价值与交互度
 */
export const convertPdfToImages = async (
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> => {
  // 1. 确保 SDK 载入
  const pdfjsLib = await ensurePdfJsLoaded();

  // 2. 将文件转换为 ArrayBuffer 读入内存
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });

  // 3. 载入 PDF 文档
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const base64Images: string[] = [];

  // 4. 循环异步渲染每一页
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    
    // 采用 1.5 倍的清晰度，既能保证 Canvas 手写细节足够清晰，又极大地压缩了 Base64 字符串体积，防堵塞
    const viewport = page.getViewport({ scale: 1.5 });
    
    // 创建一个离屏 Canvas 容器
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`第 ${pageNum} 页离屏 Canvas 上下文初始化失败`);
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // 渲染 PDF 页到离屏 Canvas 上
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    // 导出为高清 PNG Base64 数据
    const dataUrl = canvas.toDataURL('image/png');
    base64Images.push(dataUrl);

    // 触发进度回调
    if (onProgress) {
      onProgress(pageNum, numPages);
    }
  }

  return base64Images;
};
