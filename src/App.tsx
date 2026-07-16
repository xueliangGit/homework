import { useState, useEffect } from 'react';
import { api } from './api';
import type { User } from './types';
import { Login } from './components/auth/Login';
import { TeacherDashboard } from './components/dashboard/TeacherDashboard';
import { StudentDashboard } from './components/dashboard/StudentDashboard';
import { ParentDashboard } from './components/dashboard/ParentDashboard';
import { StudentWorkspace } from './components/exam/StudentWorkspace';
import { GradeWorkspace } from './components/exam/GradeWorkspace';
import { PaperViewer } from './components/shared/PaperViewer';
import { LogOut, ArrowLeft, Award } from 'lucide-react';
import { ThemeSwitcher } from './theme/ThemeSwitcher';
import { useTheme, SEGMENT_LABELS } from './theme/ThemeContext';
import { PaperLibrary } from './components/paper/PaperLibrary';
import { RecordCenter } from './components/record/RecordCenter';
import { drawReportCardCanvas, downloadReportPng, downloadReportPdf } from './utils/reportCard';
import { ToastContainer, ConfirmContainer, showToast, confirmAsync } from './utils/toast';
import { ChangePassword } from './components/auth/ChangePassword';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const { theme } = useTheme();
  
  // 视图路由状态：'login' | 'dashboard' | 'student_workspace' | 'grade_workspace' | 'report_viewer'
  const [view, setView] = useState<string>('login');

  // 工作区路由上下文参数
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>('');
  const [selectedRedo, setSelectedRedo] = useState<boolean>(false);

  // 报告浏览大厅所需数据状态
  const [viewerData, setViewerData] = useState<any>(null);
  const [viewerLoading, setViewerLoading] = useState<boolean>(false);

  // 从 localStorage 恢复登录状态
  useEffect(() => {
    const savedUser = localStorage.getItem('kaoshi_user');
    const token = localStorage.getItem('kaoshi_token');
    
    if (savedUser && token) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      setView('dashboard');
    } else {
      setView('login');
    }

    // 监听 401 鉴权过期失效事件
    const handleAuthChange = () => {
      setUser(null);
      setView('login');
    };
    window.addEventListener('auth_change', handleAuthChange);
    return () => window.removeEventListener('auth_change', handleAuthChange);
  }, []);

  const handleLoginSuccess = (loggedInUser: any) => {
    setUser(loggedInUser);
    // P2-15 学生首次登录强制改密
    setView(loggedInUser.mustChangePassword ? 'change_password' : 'dashboard');
  };

  const handleStartExam = (examId: string, redo = false) => {
    setSelectedExamId(examId);
    setSelectedRedo(redo);
    setView('student_workspace');
  };

  const handleLogout = async () => {
    const ok = await confirmAsync('确认退出登录本系统吗？');
    if (!ok) return;
    localStorage.removeItem('kaoshi_token');
    localStorage.removeItem('kaoshi_user');
    setUser(null);
    setView('login');
  };

  // 陪伴看报告大厅（载入三层画布）
  const handleOpenReportViewer = async (examId: string, studentId: string) => {
    setSelectedExamId(examId);
    setSelectedStudentId(studentId);
    setView('report_viewer');
    
    try {
      setViewerLoading(true);
      const data = await api.get<any>(`/api/exams/${examId}/submission/${studentId}`);
      setViewerData(data);
    } catch (error: any) {
      showToast(error.message || '获取学习报告失败', 'error');
      setView('dashboard');
    } finally {
      setViewerLoading(false);
    }
  };

  const handleBindSuccess = (newChildId: string, newChildIds?: string[]) => {
    if (user) {
      const childIds =
        newChildIds && newChildIds.length
          ? newChildIds
          : Array.isArray(user.childIds) && user.childIds.length
          ? [...user.childIds, newChildId].filter((v, i, a) => a.indexOf(v) === i)
          : [newChildId];
      const updatedUser = { ...user, childId: newChildId, childIds };
      setUser(updatedUser);
      localStorage.setItem('kaoshi_user', JSON.stringify(updatedUser));
    }
  };

  // 🏆 创新的“宝贝成长荣誉明信片” Canvas 原生离屏超清生成与一键下载分享机制
  const buildCardCanvas = () => {
    if (!viewerData || !viewerData.submission) return null;
    const studentName = viewerData.student?.name || '宝贝';
    const examTitle = viewerData.exam.title;
    return drawReportCardCanvas({
      studentName,
      score: viewerData.submission.score || 0,
      comment: viewerData.submission.comment || '真棒！继续加油！',
      examTitle,
      submittedAt: viewerData.submission.submittedAt,
      dimensionScores: viewerData.submission.dimensionScores,
      shareCode: viewerData.submission.shareCode,
    });
  };

  const handleGenerateCard = () => {
    const canvas = buildCardCanvas();
    if (canvas) downloadReportPng(canvas, `${viewerData!.student?.name || '宝贝'}的《${viewerData!.exam.title}》成长荣誉明信片.png`);
  };

  const handleGenerateCardPdf = () => {
    const canvas = buildCardCanvas();
    if (canvas) downloadReportPdf(canvas, `${viewerData!.student?.name || '宝贝'}的《${viewerData!.exam.title}》成长荣誉明信片.pdf`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* 极度精致且带高光的软糖头部 */}
      <header 
        className="px-6 py-4 flex items-center justify-between sticky top-0 z-50 bg-white"
        style={{
          borderBottom: '2px solid var(--color-gray-border)',
          boxShadow: '0 4px 20px rgba(100,110,130,0.04)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            onClick={() => user && setView('dashboard')}
            className="flex items-center gap-2 cursor-pointer transition-transform hover:scale-[1.02]"
          >
            <span style={{ fontSize: '28px' }} className="jelly-jump">📚</span>
            <span className="text-xl font-black text-gray-800 tracking-wider">
              快乐作业考试本
            </span>
          </div>
          <span className="badge-jelly text-[10px] bg-red-100 text-red-600 border border-red-300 font-bold scale-90 py-0.5">
            {SEGMENT_LABELS[theme]} 🍎
          </span>
          <ThemeSwitcher variant="inline" />
        </div>

        {user && (
          <div className="flex items-center gap-4">
            {/* 顶部身份大圆牌 */}
            <div 
              className="badge-jelly py-1.5 px-4 flex items-center gap-1.5"
              style={{
                backgroundColor: 
                  user.role === 'teacher' ? '#FFE8E9' :
                  user.role === 'parent' ? '#F3E8FF' : '#E8F5E9',
                color:
                  user.role === 'teacher' ? 'var(--color-secondary-depth)' :
                  user.role === 'parent' ? 'var(--color-purple-depth)' : 'var(--color-primary-depth)',
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              <span className="font-extrabold">{user.name}</span>
              <span className="text-xs opacity-75 font-bold">
                ({user.role === 'teacher' ? '教师 👩‍🏫' : user.role === 'parent' ? '家长 👨‍👩‍👧' : '学生 🎒'})
              </span>
            </div>

            <button 
              onClick={handleLogout}
              className="btn-3d text-xs py-1.5 px-3 bg-red-50 border-red-300 text-red-600 font-bold shadow-[0_3px_0_#E06C75]"
              style={{
                top: 0,
                boxShadow: '0 3px 0 #E06C75',
              }}
              title="退出登录"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline font-black">退出</span>
            </button>
          </div>
        )}
      </header>

      {/* 核心页面大屏加载区 */}
      <main className="flex-1 py-8 px-4 w-full">
        {view === 'login' && (
          <Login onLoginSuccess={handleLoginSuccess} />
        )}

        {view === 'dashboard' && user && (
          <>
            {user.role === 'teacher' && (
              <TeacherDashboard
                onGradeExam={(examId, studentId, subId) => {
                  setSelectedExamId(examId);
                  setSelectedStudentId(studentId);
                  setSelectedSubmissionId(subId);
                  setView('grade_workspace');
                }}
                onViewReport={handleOpenReportViewer}
                onOpenPapers={() => setView('paper_library')}
                onOpenLogs={() => setView('logs')}
              />
            )}
            
            {user.role === 'student' && (
              <StudentDashboard
                studentId={user.id}
                onStartExam={handleStartExam}
                onViewReport={handleOpenReportViewer}
              />
            )}

            {user.role === 'parent' && (
              <ParentDashboard
                initialChildId={user.childId}
                childIds={user.childIds}
                onBindSuccess={handleBindSuccess}
                onViewReport={handleOpenReportViewer}
              />
            )}
          </>
        )}

        {user && user.role === 'teacher' && view === 'paper_library' && (
          <PaperLibrary onBack={() => setView('dashboard')} />
        )}

        {user && user.role === 'teacher' && view === 'logs' && (
          <RecordCenter onBack={() => setView('dashboard')} />
        )}

        {view === 'student_workspace' && (
          <StudentWorkspace
            examId={selectedExamId}
            isRedo={selectedRedo}
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'change_password' && user && (
          <ChangePassword user={user} onChanged={() => setView('dashboard')} />
        )}

        {view === 'grade_workspace' && (
          <GradeWorkspace
            examId={selectedExamId}
            studentId={selectedStudentId}
            submissionId={selectedSubmissionId}
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'report_viewer' && (
          <div className="flex flex-col gap-6 w-full max-w-[1550px] mx-auto p-4 pb-12">
            {/* 报告头部 */}
            <div className="flex items-center justify-between border-b-2 border-gray-border pb-3">
              <button 
                onClick={() => setView('dashboard')} 
                className="btn-3d btn-3d-blue text-xs py-2 px-3.5"
              >
                <ArrowLeft size={16} />
                <span className="font-black">返回大厅</span>
              </button>

              <h2 className="text-xl font-black text-gray-800 flex items-center gap-1.5">
                <Award size={22} className="text-yellow-500 fill-current" />
                <span>答卷大阅兵报告 📈</span>
              </h2>

              <div className="badge-jelly bg-green-50 text-green-600 font-black border-green-200">
                成绩单 📑
              </div>
            </div>

            {viewerLoading ? (
              <div className="flex flex-col items-center justify-center p-12">
                <div style={{ fontSize: '40px' }} className="jelly-jump">🍎</div>
                <span className="font-bold text-sm text-gray-600 mt-2">报告墨水晾干中...</span>
              </div>
            ) : viewerData ? (
              <div className="flex flex-col gap-6">
                {/* 成绩牌匾 */}
                <div 
                  className="card-jelly p-6 flex flex-col sm:flex-row justify-between items-center bg-white"
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '2px solid var(--color-gray-border)',
                  }}
                >
                  <div className="flex flex-col gap-1 text-center sm:text-left">
                    <span className="text-xs text-gray-400 font-extrabold">试题: {viewerData.exam.title}</span>
                    <span className="text-lg font-black mt-1 text-gray-800">学生小朋友: {viewerData.student?.name} 🎒</span>
                  </div>
                  
                  {viewerData.submission ? (
                    <div className="flex flex-col sm:flex-row items-center gap-4 mt-4 sm:mt-0">
                      {/* 一键生成并下载宝贝成长荣誉卡片大按钮 */}
                      {viewerData.submission.status === 'graded' && (
                        <>
                          <button
                            onClick={handleGenerateCard}
                            className="btn-3d btn-3d-orange text-xs py-2.5 px-4 font-black flex items-center justify-center gap-1.5 shadow-[0_3px_0_var(--color-orange-depth)] active:scale-95"
                            style={{
                              boxShadow: '0 3px 0 var(--color-orange-depth)',
                              top: 0,
                            }}
                          >
                            <span>荣誉明信片 🏆</span>
                          </button>
                          <button
                            onClick={handleGenerateCardPdf}
                            className="btn-3d text-xs py-2.5 px-4 font-black flex items-center justify-center gap-1.5 bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5] active:scale-95"
                          >
                            <span>PDF 明信片 📄</span>
                          </button>
                        </>
                      )}

                      <div className="flex flex-col items-center sm:items-end gap-2">
                        <div className="flex items-center gap-2">
                          {viewerData.submission.status === 'graded' ? (
                            <>
                              <span className="text-xs text-gray-400 font-extrabold">老师评分：</span>
                              <span className="text-3xl font-black text-red-500 bg-white border-2 border-red-300 rounded-2xl px-4 py-1.5 rotate-[-3deg] shadow-[0_4px_0_#FF8A93]">
                                💯 {viewerData.submission.score}分
                              </span>
                            </>
                          ) : (
                            <span className="badge-jelly px-3 py-1.5 font-bold text-xs bg-yellow-50 text-yellow-600 border-yellow-200">
                              等待老师红笔批改 🖍️
                            </span>
                          )}
                        </div>

                        {viewerData.submission.comment && (
                          <span className="text-xs bg-yellow-50 border border-dashed border-yellow-300 rounded-xl p-3 font-extrabold text-gray-600 max-w-sm mt-2 text-left">
                            👩‍🏫 老师寄语: "{viewerData.submission.comment}"
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 font-extrabold">该学生小朋友尚未提交本份作业。</span>
                  )}
                </div>

                {/* 三层画布对齐大阅兵 */}
                <PaperViewer
                  pages={viewerData.exam.pages}
                  studentAnswers={viewerData.submission?.answers || []}
                  teacherAnnotations={viewerData.submission?.teacherAnnotations || []}
                />
              </div>
            ) : (
              <span className="text-sm text-gray-500 text-center">未获取到有效的报告数据。</span>
            )}
          </div>
        )}
      </main>

      {/* 可爱卡通脚部 */}
      <footer 
        className="py-4 text-center text-xs font-bold text-gray-400 border-t-2 border-gray-border bg-white"
        style={{ marginTop: 'auto' }}
      >
        <span>📚 快乐教研与作业答题大本营 ©2026 | 面向少儿量身定制 🍎</span>
      </footer>

      {/* 全局轻量 Toast + 自定义确认弹层（替代原生 alert/confirm，适配 Pad） */}
      <ToastContainer />
      <ConfirmContainer />
    </div>
  );
}

export default App;
