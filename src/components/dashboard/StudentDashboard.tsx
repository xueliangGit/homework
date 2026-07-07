import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import type { StudentExamItem } from '../../types';
import { BookOpen, Clock, BookOpenCheck } from 'lucide-react';

interface StudentDashboardProps {
  onStartExam: (examId: string) => void;
  onViewReport: (examId: string, studentId: string) => void;
  studentId: string;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  onStartExam,
  onViewReport,
  studentId,
}) => {
  const [exams, setExams] = useState<StudentExamItem[]>([]);
  const [activeTab, setActiveTab] = useState<'todo' | 'pending' | 'done'>('todo');
  const [loading, setLoading] = useState<boolean>(true);

  const loadExams = async () => {
    try {
      setLoading(true);
      const data = await api.get<StudentExamItem[]>('/api/exams/student');
      setExams(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExams();
  }, []);

  const todoExams = exams.filter(e => e.status === 'unstarted');
  const pendingExams = exams.filter(e => e.status === 'submitted');
  const doneExams = exams.filter(e => e.status === 'graded');

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-4">
      {/* 欢迎彩虹顶饰 */}
      <div 
        className="card-jelly p-6 flex flex-col md:flex-row items-center gap-4 text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, #4CD137 100%)',
          border: '2px solid var(--color-primary-depth)',
          boxShadow: '0 8px 0 var(--color-primary-depth)',
        }}
      >
        <div style={{ fontSize: '48px' }} className="jelly-jump">🎒</div>
        <div className="text-center md:text-left">
          <h2 className="text-xl font-black">哈罗！欢迎来到快乐作业岛 🏝️</h2>
          <p className="text-sm font-extrabold text-green-50 opacity-90 mt-1">这里有你所有的纸质作业图片，直接用手指或触控笔就可以在上面写字画圈答题哦！快去完成它们通关吧！</p>
        </div>
      </div>

      {/* 状态分类切换大标签 */}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => setActiveTab('todo')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'todo' ? 'btn-3d-yellow' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'todo' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <BookOpen size={15} />
          <span>待写作业 ({todoExams.length}) ✏️</span>
        </button>

        <button
          onClick={() => setActiveTab('pending')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'pending' ? 'btn-3d-blue' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'pending' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <Clock size={15} />
          <span>等待批改 ({pendingExams.length}) 💤</span>
        </button>

        <button
          onClick={() => setActiveTab('done')}
          className={`btn-3d text-xs py-2.5 px-4 flex items-center gap-2 ${
            activeTab === 'done' ? 'btn-3d-purple' : 'bg-white text-gray-700 shadow-[0_3px_0_#E5E5E5]'
          }`}
          style={{
            boxShadow: activeTab === 'done' ? undefined : '0 3px 0 #E5E5E5',
          }}
        >
          <BookOpenCheck size={15} />
          <span>已通关成就 ({doneExams.length}) 🏆</span>
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12">
          <div style={{ fontSize: '40px' }} className="jelly-jump">🍎</div>
          <span className="font-extrabold text-sm text-gray-400 mt-2">试卷飞奔派发中，请稍后...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {activeTab === 'todo' && (
            todoExams.length > 0 ? (
              todoExams.map((exam) => (
                <div 
                  key={exam.id}
                  className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white"
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <span className="badge-jelly text-xs font-black py-1 px-2.5 mb-2" style={{ backgroundColor: '#F0FDF4', color: '#16A34A', borderColor: '#BBF7D0' }}>
                        {exam.className}
                      </span>
                      <span className="text-xs text-gray-400 font-extrabold">
                        共 {exam.totalPages} 页试卷
                      </span>
                    </div>
                    <h3 className="text-lg font-black mt-1 text-gray-800">{exam.title}</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {exam.timePolicy?.deadline && (
                        <span className="badge-jelly text-[10px] bg-amber-100 text-amber-700">
                          ⏰ 截止 {new Date(exam.timePolicy.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {exam.timePolicy?.durationMin && (
                        <span className="badge-jelly text-[10px] bg-sky-100 text-sky-700">
                          ⏱ 限时 {exam.timePolicy.durationMin} 分钟
                        </span>
                      )}
                      {exam.timePolicy?.dailyWindow && (
                        <span className="badge-jelly text-[10px] bg-violet-100 text-violet-700">
                          🕐 每日 {exam.timePolicy.dailyWindow.start}-{exam.timePolicy.dailyWindow.end} 可作答
                        </span>
                      )}
                      {!exam.timePolicy && !exam.closed && (
                        <span className="badge-jelly text-[10px] bg-gray-100 text-gray-500">🕊 无时限</span>
                      )}
                      {exam.closed && (
                        <span className="badge-jelly text-[10px] bg-gray-200 text-gray-500">🔒 已关闭</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 font-extrabold">
                      发布时间: {new Date(exam.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <button
                    onClick={() => onStartExam(exam.id)}
                    className="btn-3d btn-3d-primary font-black py-2.5 w-full mt-3"
                    style={{
                      boxShadow: '0 4px 0 var(--color-primary-depth)',
                    }}
                  >
                    <span>开始答题 🖌️</span>
                  </button>
                </div>
              ))
            ) : (
              <div className="col-span-2 text-center py-12 card-jelly bg-white">
                <span style={{ fontSize: '48px' }}>🎉</span>
                <h4 className="font-black text-lg mt-2 text-gray-800">太厉害了！没有要写的作业啦！</h4>
                <p className="text-sm text-gray-400 font-extrabold mt-1">快去户外奔跑一下，或者看看已通关的题目进行错题回顾吧！</p>
              </div>
            )
          )}

          {activeTab === 'pending' && (
            pendingExams.length > 0 ? (
              pendingExams.map((exam) => (
                <div 
                  key={exam.id}
                  className="card-jelly flex flex-col gap-4 justify-between bg-white opacity-95"
                >
                  <div>
                    <span className="badge-jelly text-xs font-black py-1 px-2.5 mb-2" style={{ backgroundColor: '#F0F9FF', color: '#0284C7', borderColor: '#BAE6FD' }}>
                      {exam.className}
                    </span>
                    <h3 className="text-lg font-black text-gray-800 mt-1">{exam.title}</h3>
                    <p className="text-xs text-gray-400 mt-2 font-extrabold">
                      提交时间: {new Date(exam.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div 
                    className="p-4 rounded-2xl border text-center text-xs font-extrabold"
                    style={{ backgroundColor: '#FFFDF0', borderColor: '#FDE047', color: '#854D0E' }}
                  >
                    🚀 已经成功投递！老师正在飞速批阅，耐心等一下下哦
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-2 text-center py-12 card-jelly bg-white">
                <span style={{ fontSize: '40px' }}>💤</span>
                <p className="font-extrabold text-sm text-gray-400 mt-2">目前没有正在排队等待批改的作业。</p>
              </div>
            )
          )}

          {activeTab === 'done' && (
            doneExams.length > 0 ? (
              doneExams.map((exam) => (
                <div 
                  key={exam.id}
                  className="card-jelly card-jelly-hover flex flex-col gap-4 justify-between bg-white"
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <span className="badge-jelly text-xs font-black py-1 px-2.5 mb-2" style={{ backgroundColor: '#FAF5FF', color: '#7E22CE', borderColor: '#E9D5FF' }}>
                        {exam.className}
                      </span>
                      <span className="text-xl font-black text-red-500 bg-white border-2 border-red-300 rounded-2xl px-3 py-1 rotate-[-5deg] shadow-[0_4px_0_#FF8A93]">
                        💯 {exam.score}分
                      </span>
                    </div>
                    <h3 className="text-lg font-black text-gray-800 mt-1">{exam.title}</h3>

                    {exam.isLate && (
                      <span className="badge-jelly text-[10px] bg-orange-100 text-orange-600 mt-2">⏰ 迟交</span>
                    )}
                    
                    {exam.comment && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-dashed border-yellow-300 rounded-xl text-xs font-extrabold text-gray-500">
                        👩‍🏫 老师寄语: "{exam.comment}"
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => onViewReport(exam.id, studentId)}
                    className="btn-3d btn-3d-purple font-black py-2.5 w-full mt-3"
                    style={{
                      boxShadow: '0 4px 0 var(--color-purple-depth)',
                    }}
                  >
                    <span>错题回顾与大阅兵 📖</span>
                  </button>
                </div>
              ))
            ) : (
              <div className="col-span-2 text-center py-12 card-jelly bg-white">
                <span style={{ fontSize: '40px' }}>🏆</span>
                <p className="font-extrabold text-sm text-gray-400 mt-2">还没有批改完成的试卷，加油通关吧！</p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
