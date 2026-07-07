import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api';
import { CanvasDraw } from '../shared/CanvasDraw';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Timer } from 'lucide-react';
import confetti from 'canvas-confetti';

interface StudentWorkspaceProps {
  examId: string;
  onBack: () => void;
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const StudentWorkspace: React.FC<StudentWorkspaceProps> = ({
  examId,
  onBack,
}) => {
  const [examTitle, setExamTitle] = useState<string>('');
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [answersMap, setAnswersMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [timePolicy, setTimePolicy] = useState<any>(null);
  const [closed, setClosed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const startedAtRef = useRef<number>(Date.now());
  const autoSubmittedRef = useRef<boolean>(false);

  // 标记是否已经提示过恢复草稿，防止因 answersMap 变更导致重复弹窗
  const draftPromptedRef = useRef<boolean>(false);

  const loadExamDetail = async () => {
    try {
      setLoading(true);
      const userStr = localStorage.getItem('kaoshi_user');
      const studentId = userStr ? JSON.parse(userStr).id : '';

      const data = await api.get<any>(`/api/exams/${examId}/submission/${studentId}`);
      
      setExamTitle(data.exam.title);
      setPages(data.exam.pages);
      setTimePolicy(data.exam.timePolicy || null);
      setClosed(!!data.exam.closed);
      
      // 1. 先载入服务器上已有的作答数据
      const initialAnswers: Record<number, string> = {};
      if (data.submission && data.submission.answers) {
        data.submission.answers.forEach((ans: any) => {
          initialAnswers[ans.pageIndex] = ans.canvasData;
        });
      }
      
      // 2. 检查是否有本地意外闪退的更优草稿
      const draftStr = localStorage.getItem(`kaoshi_draft_${examId}`);
      if (draftStr && !draftPromptedRef.current) {
        draftPromptedRef.current = true;
        const draftAnswers = JSON.parse(draftStr);
        
        if (Object.keys(draftAnswers).length > 0) {
          // 延迟弹窗，防止 React 渲染时阻断
          setTimeout(() => {
            if (window.confirm('🎒 哇！检测到你上次有未交卷的作业草稿哦，是否帮你自动恢复上次的笔迹？')) {
              setAnswersMap({
                ...initialAnswers,
                ...draftAnswers
              });
            } else {
              setAnswersMap(initialAnswers);
            }
          }, 200);
          return;
        }
      }

      setAnswersMap(initialAnswers);
    } catch (err: any) {
      setErrorMsg(err.message || '获取作业详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExamDetail();
  }, [examId]);

  // 3. 静默定时自动存盘草稿箱
  useEffect(() => {
    if (Object.keys(answersMap).length > 0) {
      localStorage.setItem(`kaoshi_draft_${examId}`, JSON.stringify(answersMap));
    }
  }, [answersMap, examId]);

  // 4. 时限倒计时：每秒刷新，严格模式到点自动收卷
  useEffect(() => {
    if (!timePolicy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timePolicy]);

  // 计算剩余时间（取截止时间与倒计时时长中较早者）
  const effectiveEnd = (() => {
    if (!timePolicy) return null;
    const ends: number[] = [];
    if (typeof timePolicy.deadline === 'number') ends.push(timePolicy.deadline);
    if (typeof timePolicy.durationMin === 'number') ends.push(startedAtRef.current + timePolicy.durationMin * 60_000);
    if (ends.length === 0) return null;
    return Math.min(...ends);
  })();
  const remainingMs = effectiveEnd !== null ? effectiveEnd - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const isStrict = timePolicy?.mode === 'strict';

  // 当前是否处于「每日可作答时段」内（未设时段视为随时可作答）
  const inDailyWindow = (() => {
    const w = timePolicy?.dailyWindow;
    if (!w || !w.start || !w.end) return true;
    const toMin = (s: string) => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s === null || e === null) return true;
    const d = new Date(now);
    const cur = d.getHours() * 60 + d.getMinutes();
    return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
  })();

  // 严格模式且到点：自动收卷一次（不弹确认框）
  useEffect(() => {
    if (expired && isStrict && !autoSubmittedRef.current && !submitting) {
      autoSubmittedRef.current = true;
      handleSubmit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, isStrict]);

  const handleCanvasChange = (dataUrl: string) => {
    setAnswersMap(prev => ({
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

  const handleSubmit = async (auto = false) => {
    const answers = Object.keys(answersMap).map((key) => ({
      pageIndex: Number(key),
      canvasData: answersMap[Number(key)],
    })).filter(ans => ans.canvasData !== '');

    if (!auto && !window.confirm('小朋友，确认全部写完，要把作业本交给老师批改了吗？🎉')) return;

    setSubmitting(true);
    try {
      await api.post(`/api/exams/${examId}/submit`, { answers, startedAt: startedAtRef.current });

      // 交卷成功后，安全销毁本地临时草稿，防止二次冗余恢复
      localStorage.removeItem(`kaoshi_draft_${examId}`);

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      alert(auto ? '⏰ 时间到，作业本已自动交卷啦！你真棒！' : '🎉 恭喜你！作业本成功交上去了！你真棒！');
      setTimeout(() => {
        onBack();
      }, 1500);
    } catch (err: any) {
      alert(err.message || '提交失败了，请稍后再试一次吧！');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div style={{ fontSize: '50px' }} className="jelly-jump">🎒</div>
        <span className="font-extrabold text-sm text-gray-400 mt-3">作业本疯狂翻页中...</span>
      </div>
    );
  }

  const totalPages = pages.length;

  return (
    <div className="flex flex-col gap-4 w-full max-w-[1550px] mx-auto p-4 pb-12">
      {/* 沉浸式工作区头部 */}
      <div className="flex items-center justify-between border-b-2 border-gray-border pb-3">
        <button 
          onClick={onBack} 
          className="btn-3d btn-3d-blue text-xs py-2 px-3.5"
          style={{
            boxShadow: '0 3px 0 var(--color-blue-depth)',
          }}
        >
          <ArrowLeft size={15} />
          <span className="font-extrabold">回大厅</span>
        </button>

        <h2 className="text-xl font-black text-center text-gray-800">
          ✏️ 正在写作业: {examTitle}
        </h2>

        <div className="flex items-center gap-2">
          {timePolicy && remainingMs !== null && (
            <div
              className="badge-jelly text-xs font-black py-1.5 px-3 flex items-center gap-1"
              style={{
                backgroundColor: expired ? '#FEE2E2' : remainingMs < 60_000 ? '#FFEDD5' : '#ECFDF5',
                color: expired ? '#DC2626' : remainingMs < 60_000 ? '#EA580C' : '#16A34A',
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              <Timer size={13} />
              {expired ? '时间到' : fmtRemaining(remainingMs)}
            </div>
          )}
          {closed && (
            <div className="badge-jelly text-xs font-black py-1.5 px-3 bg-gray-200 text-gray-500">已关闭</div>
          )}
          {timePolicy?.dailyWindow && (
            <div
              className="badge-jelly text-xs font-black py-1.5 px-3 flex items-center gap-1"
              style={{
                backgroundColor: inDailyWindow ? '#ECFDF5' : '#FEF3C7',
                color: inDailyWindow ? '#16A34A' : '#B45309',
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              🕐 每日 {timePolicy.dailyWindow.start}-{timePolicy.dailyWindow.end} {inDailyWindow ? '可交卷' : '未到时间'}
            </div>
          )}
          <div 
            className="badge-jelly text-xs font-black py-1.5 px-3" 
            style={{ backgroundColor: '#FAF5FF', color: '#7E22CE', borderColor: '#E9D5FF' }}
          >
            {currentPage + 1} / {totalPages} 页
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-extrabold text-center text-red-600">
          🍎 {errorMsg}
        </div>
      )}

      {closed && (
        <div className="p-3 bg-gray-100 border border-gray-300 rounded-xl text-sm font-extrabold text-center text-gray-500">
          🔒 老师已关闭本作业，暂时无法提交。
        </div>
      )}

      {timePolicy?.dailyWindow && !inDailyWindow && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-extrabold text-center text-amber-700">
          🕐 现在不在可作答时段（每日 {timePolicy.dailyWindow.start}-{timePolicy.dailyWindow.end}），到点才能交卷哦
        </div>
      )}

      {/* 画板绘制核心区域 */}
      <div className="flex justify-center w-full my-2">
        <CanvasDraw
          key={`${currentPage}`}
          backgroundImage={pages[currentPage]}
          initialData={answersMap[currentPage]}
          mode="draw"
          onChange={handleCanvasChange}
        />
      </div>

      {/* 工作区底部翻页与提交工具栏 */}
      <div className="flex justify-between items-center w-full max-w-[1200px] mx-auto mt-4 px-2">
        <button
          onClick={handlePrev}
          disabled={currentPage === 0}
          className={`btn-3d btn-3d-blue text-xs ${currentPage === 0 ? 'btn-3d-disabled' : ''}`}
          style={{ padding: '10px 16px', boxShadow: currentPage === 0 ? undefined : '0 3px 0 var(--color-blue-depth)' }}
        >
          <ChevronLeft size={16} />
          <span className="font-extrabold">上一页</span>
        </button>

        {currentPage === totalPages - 1 ? (
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting || closed || (expired && isStrict) || !inDailyWindow}
            className="btn-3d btn-3d-secondary font-black py-3 px-6 text-sm"
            style={{ 
              boxShadow: '0 4px 0 var(--color-secondary-depth)',
              transform: 'scale(1.03)',
            }}
          >
            <Check size={16} />
            <span>{closed ? '已关闭' : (expired && isStrict) ? '已截止' : !inDailyWindow ? '未到作答时间' : '完成作业并提交老师 🎉'}</span>
          </button>
        ) : (
          <span className="text-xs text-gray-400 font-extrabold">
            写完这一页，点击“下一页”继续哦
          </span>
        )}

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
  );
};
