import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';

interface PaperViewerProps {
  pages: string[]; // 试卷多页图片列表 (Base64)
  studentAnswers?: { pageIndex: number; canvasData: string }[];
  teacherAnnotations?: { pageIndex: number; canvasData: string }[];
}

export const PaperViewer: React.FC<PaperViewerProps> = ({
  pages,
  studentAnswers = [],
  teacherAnnotations = [],
}) => {
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);

  const totalPages = pages.length;

  const currentOriginal = pages[currentPage];
  const currentStudentAnswer = studentAnswers.find(a => a.pageIndex === currentPage)?.canvasData;
  const currentAnnotation = teacherAnnotations.find(a => a.pageIndex === currentPage)?.canvasData;

  const handlePrev = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(prev => prev + 1);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* 快捷视图切换选项 */}
      <div className="flex items-center justify-between w-full max-w-[1200px] px-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnnotations(prev => !prev)}
            className="btn-3d btn-3d-yellow text-xs py-2 px-4"
            style={{
              boxShadow: '0 3px 0 var(--color-yellow-depth)',
            }}
          >
            {showAnnotations ? (
              <>
                <EyeOff size={15} />
                <span className="font-extrabold">隐藏老师的红色批改 🙈</span>
              </>
            ) : (
              <>
                <Eye size={15} />
                <span className="font-extrabold">显示老师的红色批改 🖍️</span>
              </>
            )}
          </button>
        </div>

        <div 
          className="badge-jelly text-xs font-black py-1.5 px-3" 
          style={{ backgroundColor: '#E0F2FE', color: '#0369A1', borderColor: '#BAE6FD' }}
        >
          第 {currentPage + 1} 页 / 共 {totalPages} 页
        </div>
      </div>

      {/* 三层叠加渲染容器 */}
      <div
        style={{
          position: 'relative',
          border: '2px solid var(--color-gray-border)',
          borderRadius: '24px',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 12px 24px rgba(100,110,130,0.06), 0 4px 0 var(--color-gray-border)',
          width: '100%',
          maxWidth: '1200px',
        }}
      >
        {/* 1. 底层：原始试卷图片 */}
        {currentOriginal && (
          <img
            src={currentOriginal}
            alt={`试卷原始第 ${currentPage + 1} 页`}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* 2. 中层：学生答题手写笔迹 */}
        {currentStudentAnswer && (
          <img
            src={currentStudentAnswer}
            alt="学生答题笔迹"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        )}

        {/* 3. 顶层：老师红笔批改笔迹 */}
        {currentAnnotation && showAnnotations && (
          <img
            src={currentAnnotation}
            alt="老师红笔批改"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        )}
      </div>

      {/* 左右翻页控制器 */}
      {totalPages > 1 && (
        <div className="flex items-center gap-6 mt-3">
          <button
            onClick={handlePrev}
            disabled={currentPage === 0}
            className={`btn-3d btn-3d-blue text-xs ${currentPage === 0 ? 'btn-3d-disabled' : ''}`}
            style={{ padding: '8px 16px', boxShadow: currentPage === 0 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
          >
            <ChevronLeft size={16} />
            <span className="font-extrabold">上一页</span>
          </button>
          
          <span style={{ fontWeight: '800', fontSize: '15px', color: 'var(--color-text)' }}>
            第 {currentPage + 1} / {totalPages} 页
          </span>

          <button
            onClick={handleNext}
            disabled={currentPage === totalPages - 1}
            className={`btn-3d btn-3d-blue text-xs ${currentPage === totalPages - 1 ? 'btn-3d-disabled' : ''}`}
            style={{ padding: '8px 16px', boxShadow: currentPage === totalPages - 1 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
          >
            <span className="font-extrabold">下一页</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
