import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import { showToast, confirmAsync } from '../../utils/toast';
import { CanvasDraw } from '../shared/CanvasDraw';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3 } from 'lucide-react';

// 能力维度默认值（用于成长雷达图，老师可按需覆盖评分）
const DEFAULT_DIMENSIONS = [
  { key: 'calc', label: '计算能力', full: 100 },
  { key: 'write', label: '书写工整', full: 100 },
  { key: 'logic', label: '逻辑思维', full: 100 },
  { key: 'speed', label: '答题速度', full: 100 },
  { key: 'attitude', label: '学习态度', full: 100 },
];

interface GradeWorkspaceProps {
  examId: string;
  studentId: string;
  submissionId: string;
  onBack: () => void;
}

export const GradeWorkspace: React.FC<GradeWorkspaceProps> = ({
  examId,
  studentId,
  submissionId,
  onBack,
}) => {
  const [examTitle, setExamTitle] = useState<string>('');
  const [studentName, setStudentName] = useState<string>('');
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, string>>({});
  const [annotationsMap, setAnnotationsMap] = useState<Record<number, string>>({});

  const [selectedStamp, setSelectedStamp] = useState<string | null>(null);

  const [score, setScore] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [dimensionScores, setDimensionScores] = useState<{ key: string; label: string; score: number; full: number }[]>(
    DEFAULT_DIMENSIONS.map(d => ({ ...d, score: 0 }))
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const loadSubmissionDetail = async () => {
    try {
      setLoading(true);
      const data = await api.get<any>(`/api/exams/${examId}/submission/${studentId}`);
      
      setExamTitle(data.exam.title);
      setStudentName(data.student ? data.student.name : '未知学生');
      setPages(data.exam.pages);

      if (data.submission && data.submission.answers) {
        const studentAns: Record<number, string> = {};
        data.submission.answers.forEach((ans: any) => {
          studentAns[ans.pageIndex] = ans.canvasData;
        });
        setStudentAnswers(studentAns);
      }

      if (data.submission && data.submission.teacherAnnotations) {
        const teacherAnn: Record<number, string> = {};
        data.submission.teacherAnnotations.forEach((ann: any) => {
          teacherAnn[ann.pageIndex] = ann.canvasData;
        });
        setAnnotationsMap(teacherAnn);
        setScore(String(data.submission.score || ''));
        setComment(data.submission.comment || '');
        if (data.submission.dimensionScores && data.submission.dimensionScores.length) {
          setDimensionScores(
            data.submission.dimensionScores.map((d: any) => ({
              key: d.key,
              label: d.label,
              score: Number(d.score) || 0,
              full: d.full || 100,
            }))
          );
        } else {
          setDimensionScores(DEFAULT_DIMENSIONS.map(d => ({ ...d, score: 0 })));
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || '获取答卷详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissionDetail();
  }, [examId, studentId]);

  const handleCanvasChange = (dataUrl: string) => {
    setAnnotationsMap(prev => ({
      ...prev,
      [currentPage]: dataUrl,
    }));
  };

  const handlePrev = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < pages.length - 1) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const handleDimChange = (idx: number, val: string) => {
    const num = Number(val);
    setDimensionScores(prev =>
      prev.map((d, i) => (i === idx ? { ...d, score: isNaN(num) ? 0 : num } : d))
    );
  };

  const handleGradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score === '') {
      showToast('老师，请先给这份卷子打个分数吧 💯', 'error');
      return;
    }

    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
      showToast('打分范围应该在 0 ~ 100 分之间哦', 'error');
      return;
    }

    const teacherAnnotations = Object.keys(annotationsMap).map((key) => ({
      pageIndex: Number(key),
      canvasData: annotationsMap[Number(key)],
    })).filter(ann => ann.canvasData !== '');

    const ok = await confirmAsync(`确认给学生【${studentName}】评分：${score}分 吗？`);
    if (!ok) return;
    setSubmitting(true);
    try {
      // 雷达图维度：老师未填的维度回退为总分，保证雷达图饱满可读
      const dims = dimensionScores.map(d => ({
        key: d.key,
        label: d.label,
        score: d.score > 0 ? d.score : numScore,
        full: d.full,
      }));

      const res = await api.post<{ data: any }>(`/api/submissions/${submissionId}/grade`, {
        score: numScore,
        comment: comment,
        teacherAnnotations,
        dimensionScores: dims,
      });

      // P2-11 迟交扣分提示
      const penalty = res?.data?.latePenaltyApplied || 0;
      if (penalty > 0) {
        showToast(`📝 批改成功！已扣除迟交 ${penalty} 分（最终 ${res?.data?.score} 分）`, 'success');
      } else {
        showToast('📝 批改成功！成绩和红笔字迹已实时同步给学生与家长。', 'success');
      }
      onBack();
    } catch (err: any) {
      showToast(err.message || '保存批改失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div style={{ fontSize: '50px' }} className="jelly-jump">👩‍🏫</div>
        <span className="font-extrabold text-sm text-gray-400 mt-3">红墨水加满中，请稍候...</span>
      </div>
    );
  }

  const totalPages = pages.length;

  return (
    <div className="flex flex-col gap-4 w-full max-w-[1550px] mx-auto p-4 pb-12">
      {/* 头部导航 */}
      <div className="flex items-center justify-between border-b-2 border-gray-border pb-3">
        <button 
          onClick={onBack} 
          className="btn-3d btn-3d-blue text-xs py-2 px-3.5"
          style={{
            boxShadow: '0 3px 0 var(--color-blue-depth)',
          }}
        >
          <ArrowLeft size={15} />
          <span className="font-extrabold">返回监控</span>
        </button>

        <h2 className="text-xl font-black text-center text-gray-800 flex items-center gap-2">
          <Edit3 size={22} className="text-red-500" />
          <span>正在阅卷: 【{studentName}】的答卷 - {examTitle}</span>
        </h2>

        <div 
          className="badge-jelly text-xs font-black py-1.5 px-3" 
          style={{ backgroundColor: '#FAF5FF', color: '#7E22CE', borderColor: '#E9D5FF' }}
        >
          {currentPage + 1} / {totalPages} 页
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-extrabold text-center text-red-600">
          🍎 {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* 左侧 3 列：试卷手写批改画板 */}
        <div className="lg:col-span-3 flex flex-col items-center gap-4">
          <CanvasDraw
            key={`${currentPage}`}
            backgroundImage={pages[currentPage]}
            studentAnswer={studentAnswers[currentPage]}
            initialData={annotationsMap[currentPage]}
            mode="grade"
            onChange={handleCanvasChange}
            activeStamp={selectedStamp}
            // 支持连续盖章，盖戳后不自动清空选中的印章，老师再次点击点亮印章或换工具即可换回普通画笔
          />

          {/* 翻页栏 */}
          <div className="flex items-center gap-6 mt-3">
            <button
              onClick={handlePrev}
              disabled={currentPage === 0}
              className={`btn-3d btn-3d-blue text-xs ${currentPage === 0 ? 'btn-3d-disabled' : ''}`}
              style={{ padding: '10px 16px', boxShadow: currentPage === 0 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
            >
              <ChevronLeft size={16} />
              <span className="font-extrabold">上一页</span>
            </button>

            <span className="font-extrabold text-sm text-gray-500">
              第 {currentPage + 1} / {totalPages} 页
            </span>

            <button
              onClick={handleNext}
              disabled={currentPage === totalPages - 1}
              className={`btn-3d btn-3d-blue text-xs ${currentPage === totalPages - 1 ? 'btn-3d-disabled' : ''}`}
              style={{ padding: '10px 16px', boxShadow: currentPage === totalPages - 1 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
            >
              <span className="font-extrabold">下一页</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* 右侧 1 列：打分与写评语控制台 */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <form 
            onSubmit={handleGradeSubmit} 
            className="card-jelly bg-white flex flex-col gap-5 sticky top-4"
            style={{
              border: '2px solid var(--color-gray-border)',
            }}
          >
            <h3 className="text-md font-black border-b-2 border-gray-border pb-3 text-center text-red-500 flex items-center justify-center gap-1">
              <span>💯 批改与评分台</span>
            </h3>

            {/* 教师快捷红印章选择器 */}
            <div className="flex flex-col gap-2 border-b-2 border-gray-border pb-4">
              <label className="text-xs font-black text-gray-400">🖍️ 快捷评语红印章：</label>
              <div className="flex gap-2 justify-between">
                {[
                  { icon: '🌟', text: '大有进步' },
                  { icon: '☘️', text: '继续努力' },
                  { icon: '💯', text: '棒极了' },
                ].map((stamp) => {
                  const stampVal = `${stamp.icon} ${stamp.text}`;
                  const isSelected = selectedStamp === stampVal;
                  return (
                    <button
                      key={stampVal}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedStamp(null);
                        } else {
                          setSelectedStamp(stampVal);
                        }
                      }}
                      className={`flex-1 flex flex-col items-center justify-center p-2 rounded-2xl border-2 transition-all active:scale-95 text-xs font-black cursor-pointer ${
                        isSelected
                          ? 'bg-[#FF8A93] text-white border-[#E06C75]'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                      style={{
                        boxShadow: isSelected ? '0 3px 0 #E06C75' : '0 3px 0 #E5E5E5',
                        top: 0,
                      }}
                    >
                      <span className="text-lg mb-1">{stamp.icon}</span>
                      <span className="text-[10px]">{stamp.text}</span>
                    </button>
                  );
                })}
              </div>
              {selectedStamp && (
                <div className="text-[10px] text-red-500 font-extrabold text-center mt-1 animate-pulse">
                  💡 已选中印章，请在左侧试卷上直接点击盖章！
                </div>
              )}
            </div>

            {/* 分数输入 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black text-gray-400">给出成绩分 (0-100)：</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="请输入分数"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="input-jelly text-center text-red-500 font-black"
                style={{ fontSize: '28px', padding: '10px' }}
                required
              />
            </div>

            {/* 评语输入 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black text-gray-400">写点批改寄语或评语吧：</label>
              <textarea
                placeholder="如: 小朋友做得很棒，书写也很工整，继续加油！👍"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="input-jelly text-xs font-extrabold"
                rows={4}
                style={{ resize: 'none', lineHeight: '1.5' }}
              />
            </div>

            {/* 能力维度评分（雷达图数据来源） */}
            <div className="flex flex-col gap-2 border-t-2 border-gray-border pt-4">
              <label className="text-xs font-black text-gray-400">📊 能力维度评分（生成成长雷达图，留空按总分计）：</label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {dimensionScores.map((d, idx) => (
                  <div key={d.key} className="flex items-center gap-1.5">
                    <span className="text-[11px] font-extrabold text-gray-600 flex-1">{d.label}</span>
                    <input
                      type="number"
                      min="0"
                      max={d.full}
                      placeholder={`${d.full}`}
                      value={d.score === 0 ? '' : d.score}
                      onChange={(e) => handleDimChange(idx, e.target.value)}
                      className="input-jelly text-center text-xs font-black"
                      style={{ width: '62px', padding: '6px' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={submitting}
              className="btn-3d btn-3d-secondary font-black py-3.5 mt-2 flex items-center justify-center gap-2"
              style={{
                boxShadow: '0 4px 0 var(--color-secondary-depth)',
              }}
            >
              <span>保存并发布成绩 📝</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
