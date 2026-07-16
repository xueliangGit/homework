import React, { useRef, useState, useEffect } from 'react';
import { CanvasToolbar } from './CanvasToolbar';
import { confirmAsync } from '../../utils/toast';

interface CanvasDrawProps {
  backgroundImage?: string; // 试卷背景图片 (Base64 或 URL)
  studentAnswer?: string;   // 可选：学生答题透明笔迹图 (用于老师批改)
  initialData?: string;    // 已有的涂鸦 Base64 PNG 数据
  mode: 'draw' | 'grade' | 'readonly'; // 模式：学生画笔、教师红笔、只读回显
  onChange?: (canvasData: string) => void; // 每次松开画笔时触发
  activeStamp?: string | null; // 激活的快捷红印章
  onStampUsed?: () => void; // 盖章成功后的回调
}

export const CanvasDraw: React.FC<CanvasDrawProps> = ({
  backgroundImage,
  studentAnswer,
  initialData,
  mode,
  onChange,
  activeStamp,
  onStampUsed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [brushColor, setBrushColor] = useState<string>(mode === 'grade' ? '#FF5C5C' : '#3A86FF');
  const [brushWidth, setBrushWidth] = useState<number>(3);
  
  // 撤销历史栈
  const [history, setHistory] = useState<string[]>([]);

  // 极速丝滑书写算法 Ref
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastMidPointRef = useRef<{ x: number; y: number } | null>(null);

  // 笔刷调节预览圈动效
  const [previewOpacity, setPreviewOpacity] = useState<number>(0);
  const previewTimeoutRef = useRef<any>(null);
  const isFirstRender = useRef<boolean>(true);

  // 橡皮擦与印章范围虚线圆圈指示器
  const [cursorIndicator, setCursorIndicator] = useState<{
    x: number;
    y: number;
    show: boolean;
    type: 'eraser' | 'stamp' | 'none';
  } | null>(null);

  // 动态同步大屏 DOM 的显示宽度，确保预览圈和范围指示器精准吻合无偏斜
  const [domWidth, setDomWidth] = useState<number>(800);

  // 移动端双指缩放/平移 + 触觉反馈（让平板书写像真本子一样自然）
  const [transform, setTransform] = useState<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{
    dist: number; scale: number; x: number; y: number;
    rectLeft: number; rectTop: number; midX: number; midY: number;
  } | null>(null);
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const haptic = (pattern: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch { /* 不支持触觉的设备静默忽略 */ }
  };


  // 同步模式下的默认笔迹颜色
  useEffect(() => {
    setBrushColor(mode === 'grade' ? '#FF5C5C' : '#3A86FF');
  }, [mode]);

  // 当粗细改变时，触发预览圈
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPreviewOpacity(0.85);
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewOpacity(0);
    }, 1000);

    return () => {
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, [brushWidth]);

  // 监听画布尺寸
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    // 采用图片原始物理自然高宽作为 Canvas 的逻辑坐标参考，确保在全屏幕和多终端上笔画坐标 100% 对齐不拉伸、不偏位
    canvas.width = img.naturalWidth || img.clientWidth || 800;
    canvas.height = img.naturalHeight || img.clientHeight || 1100;

    // 动态维护并同步真实的 DOM 显示大小，为范围跟随圈提供精准缩放折算比率
    const rect = canvas.getBoundingClientRect();
    setDomWidth(rect.width || img.clientWidth || 800);

    drawInitialData();
  };

  const drawInitialData = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !initialData) return;

    const img = new Image();
    img.src = initialData;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  useEffect(() => {
    // 切换试卷/页面时复位缩放与平移，避免上一页的视图状态带到下一页
    setTransform({ scale: 1, x: 0, y: 0 });
    pinchRef.current = null;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [backgroundImage, initialData]);

  // 计算相对坐标
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    // 折算因子：当 Canvas 逻辑物理分辨率大于实际显示 DOM 宽高时，对点击坐标进行原尺寸放大对齐
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }
  };

  // 快捷红印章绘制核心算法 (带倾斜与趣味排版)
  const drawStamp = (x: number, y: number, stampText: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    haptic([14]);
    saveHistoryState();

    const scaleFactor = canvas.width / 800; // 物理像素折算比例，以逻辑宽 800px 作为 1:1 标准

    ctx.save();
    ctx.translate(x, y);

    // 随机微小倾斜拟真感 (约 -5.7度 到 5.7度)
    const angle = (Math.random() - 0.5) * 0.2;
    ctx.rotate(angle);

    const stampColor = '#FF5C5C';
    ctx.strokeStyle = stampColor;
    ctx.fillStyle = stampColor;

    // 1. 绘制圆形外框
    ctx.lineWidth = 3.5 * scaleFactor;
    ctx.beginPath();
    ctx.arc(0, 0, 36 * scaleFactor, 0, Math.PI * 2);
    ctx.stroke();

    // 2. 绘制中文字文字排版
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 去掉表情符号前缀
    const cleanText = stampText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "").trim();

    if (cleanText.length === 4) {
      ctx.font = `bold ${Math.round(13 * scaleFactor)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillText(cleanText.substring(0, 2), 0, -7 * scaleFactor);
      ctx.fillText(cleanText.substring(2, 4), 0, 7 * scaleFactor);
    } else if (cleanText.length === 3) {
      ctx.font = `bold ${Math.round(13 * scaleFactor)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillText(cleanText.substring(0, 1), 0, -7 * scaleFactor);
      ctx.fillText(cleanText.substring(1, 3), 0, 7 * scaleFactor);
    } else {
      ctx.font = `bold ${Math.round(15 * scaleFactor)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillText(cleanText, 0, 0);
    }

    ctx.restore();
    triggerChange();
  };

  // 开始手写轨迹 / 盖章
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (mode === 'readonly') return;
    
    const coords = getCoordinates(e);
    if (!coords) return;

    // 触觉反馈：落笔轻震，盖章稍重（仅支持的设备生效）
    haptic(activeStamp ? [12] : [8]);

    // 若有激活印章，则进行盖章而非画线
    if (activeStamp) {
      drawStamp(coords.x, coords.y, activeStamp);
      if (onStampUsed) {
        onStampUsed();
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    saveHistoryState();

    const scaleFactor = canvas.width / 800; // 笔划粗细等比例像素折算

    // 画一个微小的起点，消除只点不移不显墨的顽疾
    ctx.beginPath();
    ctx.lineWidth = (tool === 'eraser' ? brushWidth * 4 : brushWidth) * scaleFactor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushColor;
    }
    ctx.moveTo(coords.x, coords.y);
    ctx.lineTo(coords.x + 0.1, coords.y + 0.1);
    ctx.stroke();

    lastPointRef.current = coords;
    lastMidPointRef.current = coords;
    setIsDrawing(true);
    
    if ('touches' in e) {
      e.preventDefault();
    }
  };

  // 二次贝塞尔曲线动态插值平滑算法
  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    updateCursorIndicator(e);

    if (!isDrawing || mode === 'readonly') return;

    const coords = getCoordinates(e);
    if (!coords || !lastPointRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const scaleFactor = canvas.width / 800;

    const p1 = lastPointRef.current;
    const p2 = coords;
    
    // 计算两点之间的中点作为终点
    const midPoint = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    ctx.beginPath();
    ctx.lineWidth = (tool === 'eraser' ? brushWidth * 4 : brushWidth) * scaleFactor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushColor;
    }

    // 采用上个中点至当前中点，以上个采样点 p1 为控制点的平滑拟合
    if (lastMidPointRef.current) {
      ctx.moveTo(lastMidPointRef.current.x, lastMidPointRef.current.y);
    } else {
      ctx.moveTo(p1.x, p1.y);
    }
    ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y);
    ctx.stroke();

    lastMidPointRef.current = midPoint;
    lastPointRef.current = p2;

    if ('touches' in e) {
      e.preventDefault();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    
    // 补齐尾巴
    if (canvas && ctx && lastPointRef.current && lastMidPointRef.current) {
      const scaleFactor = canvas.width / 800;
      ctx.beginPath();
      ctx.lineWidth = (tool === 'eraser' ? brushWidth * 4 : brushWidth) * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = brushColor;
      }
      ctx.moveTo(lastMidPointRef.current.x, lastMidPointRef.current.y);
      ctx.lineTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.stroke();
    }

    setIsDrawing(false);
    lastPointRef.current = null;
    lastMidPointRef.current = null;
    triggerChange();
  };

  const saveHistoryState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL();
    setHistory(prev => [...prev, dataUrl]);
  };

  const triggerChange = () => {
    const canvas = canvasRef.current;
    if (canvas && onChange) {
      onChange(canvas.toDataURL());
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    
    haptic([10]);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));

    const img = new Image();
    img.src = previousState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      triggerChange();
    };
  };

  const handleClear = async () => {
    if (await confirmAsync('小朋友，确认要清空这一页的全部写字内容吗？', '清空', '保留')) {
      haptic([10]);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      saveHistoryState();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      triggerChange();
    }
  };

  // 橡皮擦及印章跟随的虚拟范围指示器更新
  const updateCursorIndicator = (e: React.MouseEvent | React.TouchEvent) => {
    if (mode === 'readonly') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // 算出相对 Canvas 在 DOM 里的实际像素坐标，解决由于 Canvas 物理分辨率 naturalWidth 与 DOM 尺寸拉伸导致的错位 Bug
    const domX = clientX - rect.left;
    const domY = clientY - rect.top;

    // 判断坐标越界边界，防止跑偏到 Canvas 外部显示
    if (domX < 0 || domY < 0 || domX > rect.width || domY > rect.height) {
      setCursorIndicator(null);
      return;
    }

    if (activeStamp) {
      setCursorIndicator({
        x: domX,
        y: domY,
        show: true,
        type: 'stamp',
      });
    } else if (tool === 'eraser') {
      setCursorIndicator({
        x: domX,
        y: domY,
        show: true,
        type: 'eraser',
      });
    } else {
      setCursorIndicator(null);
    }
  };

  const clearCursorIndicator = () => {
    setCursorIndicator(null);
  };

  // ============ 双指缩放 / 平移（移动端）============
  const getTouchDistance = (e: React.TouchEvent) => {
    const a = e.touches[0];
    const b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const getTouchMid = (e: React.TouchEvent) => ({ x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 });

  const onCanvasTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const mid = getTouchMid(e);
      pinchRef.current = {
        dist: getTouchDistance(e),
        scale: transform.scale,
        x: transform.x,
        y: transform.y,
        rectLeft: rect.left,
        rectTop: rect.top,
        midX: mid.x,
        midY: mid.y,
      };
      // 双指进入缩放模式：取消正在进行的书写
      if (isDrawing) {
        setIsDrawing(false);
        lastPointRef.current = null;
        lastMidPointRef.current = null;
      }
      e.preventDefault();
      return;
    }
    // 单指：正常书写
    startDrawing(e);
  };

  const onCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const p = pinchRef.current;
      const dist = getTouchDistance(e);
      const mid = getTouchMid(e);
      const newScale = clamp((p.scale * dist) / p.dist, 1, 4);
      // 让双指中点“锚定”在内容上的同一点，避免缩放时画面乱飘
      const contentX = (p.midX - p.rectLeft - p.x) / p.scale;
      const contentY = (p.midY - p.rectTop - p.y) / p.scale;
      const newX = mid.x - p.rectLeft - contentX * newScale;
      const newY = mid.y - p.rectTop - contentY * newScale;
      setTransform({ scale: newScale, x: newX, y: newY });
      return;
    }
    draw(e);
  };

  const onCanvasTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) {
      pinchRef.current = null;
      stopDrawing();
    } else if (e.touches.length === 1) {
      // 从双指退回单指：结束缩放，本笔不再续写
      pinchRef.current = null;
    }
  };

  // 桌面端：Ctrl + 滚轮以光标为焦点缩放
  const onCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const newScale = clamp(transform.scale * (1 - e.deltaY * 0.0015), 1, 4);
    const contentX = (e.clientX - rect.left - transform.x) / transform.scale;
    const contentY = (e.clientY - rect.top - transform.y) / transform.scale;
    setTransform({
      scale: newScale,
      x: e.clientX - rect.left - contentX * newScale,
      y: e.clientY - rect.top - contentY * newScale,
    });
  };

  return (
    <div className="flex flex-col gap-4 w-full items-center">
      {/* 画布核心容器 */}
      <div
        ref={containerRef}
        onMouseMove={updateCursorIndicator}
        onMouseLeave={clearCursorIndicator}
        onTouchMove={updateCursorIndicator}
        onTouchEnd={clearCursorIndicator}
        style={{
          position: 'relative',
          border: '2px solid var(--color-gray-border)',
          borderRadius: '24px',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 12px 24px rgba(100,110,130,0.06), 0 4px 0 var(--color-gray-border)',
          width: '100%',
          maxWidth: '1200px', // 拓宽画板最大自适应宽度，释放超大屏大视野
        }}
      >
        {/* 缩放/平移舞台：双指手势作用于此层，书写坐标靠 getBoundingClientRect 自动对齐 */}
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            width: '100%',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
        {backgroundImage ? (
          <>
            <img
              ref={imgRef}
              src={backgroundImage}
              alt="试卷背景"
              onLoad={resizeCanvas}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
            {studentAnswer && (
              <img
                src={studentAnswer}
                alt="学生答题笔迹"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  zIndex: 2,
                }}
              />
            )}
          </>
        ) : (
          <div ref={imgRef} style={{ width: '100%', height: '500px' }} />
        )}

        {/* 1. 临时笔刷粗细调节预览圈 (DOM 比例缩放) */}
        {previewOpacity > 0 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: `${(tool === 'eraser' ? brushWidth * 4 : brushWidth) * (domWidth / 800)}px`,
              height: `${(tool === 'eraser' ? brushWidth * 4 : brushWidth) * (domWidth / 800)}px`,
              borderRadius: '50%',
              backgroundColor: tool === 'eraser' ? 'rgba(0,0,0,0.1)' : (mode === 'grade' ? 'rgba(255,92,92,0.6)' : 'rgba(58,134,255,0.6)'),
              border: '2px solid #2D3748',
              pointerEvents: 'none',
              zIndex: 20,
              opacity: previewOpacity,
              transition: 'opacity 0.2s ease-in-out, width 0.05s ease, height 0.05s ease',
            }}
          />
        )}

        {/* 2. 橡皮擦直径指示器与红印章落脚预览圈 (DOM 比例缩放) */}
        {cursorIndicator && cursorIndicator.show && (
          <div
            style={{
              position: 'absolute',
              left: `${cursorIndicator.x}px`,
              top: `${cursorIndicator.y}px`,
              transform: 'translate(-50%, -50%)',
              width: `${(cursorIndicator.type === 'eraser' ? brushWidth * 4 : 72) * (domWidth / 800)}px`,
              height: `${(cursorIndicator.type === 'eraser' ? brushWidth * 4 : 72) * (domWidth / 800)}px`,
              borderRadius: '50%',
              border: cursorIndicator.type === 'eraser' ? '2px dashed #2D3748' : '2px dashed #FF5C5C',
              backgroundColor: cursorIndicator.type === 'eraser' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 92, 92, 0.08)',
              pointerEvents: 'none',
              zIndex: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {cursorIndicator.type === 'stamp' && activeStamp && (
              <span 
                style={{
                  color: '#FF5C5C',
                  fontSize: `${8 * (domWidth / 800)}px`, // 字体大小也按大屏 DOM 比例缩放对齐
                  fontWeight: 'bold',
                  opacity: 0.6,
                  textAlign: 'center',
                  lineHeight: '1',
                  userSelect: 'none',
                }}
              >
                {activeStamp.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")}
              </span>
            )}
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={onCanvasTouchStart}
          onTouchMove={onCanvasTouchMove}
          onTouchEnd={onCanvasTouchEnd}
          onWheel={onCanvasWheel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            cursor: mode === 'readonly' ? 'default' : (activeStamp ? 'pointer' : (tool === 'pen' ? 'crosshair' : 'none')),
            touchAction: 'none',
            zIndex: 10,
          }}
        />
        </div>{/* end stage */}
      </div>

      {/* 画布控制工具栏 */}
      {mode !== 'readonly' && (
        <CanvasToolbar
          tool={tool}
          setTool={setTool}
          brushColor={brushColor}
          setBrushColor={setBrushColor}
          brushWidth={brushWidth}
          setBrushWidth={setBrushWidth}
          mode={mode}
          historyLength={history.length}
          handleUndo={handleUndo}
          handleClear={handleClear}
          activeStamp={activeStamp}
          onClearStamp={onStampUsed}
        />
      )}
    </div>
  );
};
