import { Response } from 'express';
import { db, Exam, Submission, User } from '../db';
import { AuthRequest } from '../middleware/auth';
import { evaluateSubmitTime } from './assignments';

const generateId = () => Math.random().toString(36).substring(2, 11);

// 1. 教师：发布试卷
export const createExam = async (req: AuthRequest, res: Response) => {
  const { title, classId, pages } = req.body;
  const teacherId = req.user!.id;

  if (!title || !classId || !pages || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ message: '请提供完整的试卷标题、班级并上传至少一页试卷' });
  }

  try {
    const classes = await db.getCollection('classes');
    const hasClass = classes.some(c => c.id === classId && c.teacherId === teacherId);
    if (!hasClass) {
      return res.status(403).json({ message: '此班级不存在或您不是该班级的任课老师' });
    }

    const newExam: Exam = {
      id: generateId(),
      title,
      teacherId,
      classId,
      createdAt: Date.now(),
      totalPages: pages.length,
      pages, // 页面 Base64 数据数组
    };

    const exams = await db.getCollection('exams');
    exams.push(newExam);
    await db.saveCollection('exams', exams);

    // 响应排除大体积 pages（Base64 图片数组），前端列表无需原卷数据，减轻带宽
    const { pages: _omit, ...examSummary } = newExam;
    res.status(201).json({ message: '试卷发布成功！全班学生可立即在他们的客户端答题', data: examSummary });
  } catch (error) {
    console.error('发布试卷错误：', error);
    res.status(500).json({ message: '发布试卷失败，请稍后重试' });
  }
};

// 2. 教师：获取指定班级发布的试卷列表
export const getClassExams = async (req: AuthRequest, res: Response) => {
  const { classId } = req.params;
  const teacherId = req.user!.id;

  try {
    const exams = await db.getCollection('exams');
    const classExams = exams.filter(e => e.classId === classId && e.teacherId === teacherId);
    
    // 解构排除大体积 pages 数据，只返回元数据，极大降低带宽占用
    const listResult = classExams.map(exam => {
      const { pages, ...rest } = exam;
      return rest;
    });
    
    res.json(listResult);
  } catch (error) {
    console.error('获取班级试卷错误：', error);
    res.status(500).json({ message: '获取试卷列表失败' });
  }
};

// 3. 学生：获取自己名下的试卷列表及其答题状态
export const getStudentExams = async (req: AuthRequest, res: Response) => {
  const studentId = req.user!.id;

  try {
    const classes = await db.getCollection('classes');
    const studentClasses = classes.filter(c => c.studentIds.includes(studentId));
    const classIds = studentClasses.map(c => c.id);

    const exams = await db.getCollection('exams');
    const studentExams = exams.filter(e => classIds.includes(e.classId));

    const submissions = await db.getCollection('submissions');
    
    // 联合查询，附带学生的完成进度
    const result = studentExams.map(exam => {
      const submission = submissions.find(s => s.examId === exam.id && s.studentId === studentId);
      
      const teacherClass = studentClasses.find(c => c.id === exam.classId);

      return {
        id: exam.id,
        title: exam.title,
        classId: exam.classId,
        className: teacherClass ? teacherClass.name : '未知班级',
        createdAt: exam.createdAt,
        totalPages: exam.totalPages,
        status: submission ? submission.status : 'unstarted', // 'unstarted' | 'submitted' | 'graded'
        score: submission?.score,
        comment: submission?.comment,
        submissionId: submission?.id,
        timePolicy: exam.timePolicy || null,
        closed: !!exam.closed,
        theme: exam.theme || null,
        isLate: submission?.isLate || false,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('学生获取试卷错误：', error);
    res.status(500).json({ message: '获取作业列表失败' });
  }
};

// 4. 学生：直接提交答卷（画布涂鸦）
export const submitExam = async (req: AuthRequest, res: Response) => {
  const { examId } = req.params;
  const { answers, startedAt } = req.body; // Array of { pageIndex: number, canvasData: string }
  const studentId = req.user!.id;

  if (!answers || !Array.isArray(answers)) {
    return res.status(400).json({ message: '答卷涂鸦笔迹不能为空' });
  }

  try {
    // 安全校验：学生必须属于该试卷对应的班级，防止提交到任意试卷
    const exams = await db.getCollection('exams');
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
      return res.status(404).json({ message: '未找到该试卷' });
    }
    const classes = await db.getCollection('classes');
    const examClass = classes.find(c => c.id === exam.classId);
    if (!examClass || !examClass.studentIds.includes(studentId)) {
      return res.status(403).json({ message: '您不属于该试卷对应的班级，无法提交此答卷' });
    }

    // 时限策略校验（截止时间 / 倒计时作答时长）
    if (exam.timePolicy || exam.closed) {
      const verdict = evaluateSubmitTime(exam, typeof startedAt === 'number' ? startedAt : undefined);
      if (!verdict.allowed) {
        return res.status(403).json({ message: verdict.reason || '当前无法提交本作业' });
      }
    }

    const submissions = await db.getCollection('submissions');
    let submission = submissions.find(s => s.examId === examId && s.studentId === studentId);

    // 不允许重复提交：若该作业配置禁止重做且已提交，则拦截
    if (submission) {
      if (submission.status === 'graded') {
        return res.status(400).json({ message: '老师已经完成批改，无法修改答卷' });
      }
      // 查询作业是否允许重做
      const assignments = await db.getCollection('assignments');
      const assign = assignments.find((a: any) => a.examIds?.includes(examId));
      if (assign && assign.allowRedo === false) {
        return res.status(400).json({ message: '本作业不允许重复提交，请耐心等待老师批改' });
      }
      submission.answers = answers;
      submission.submittedAt = Date.now();
      submission.status = 'submitted';
      // 迟交标记
      const v = evaluateSubmitTime(exam, typeof startedAt === 'number' ? startedAt : undefined);
      if (v.isLate) {
        submission.isLate = true;
        const base = typeof exam.timePolicy?.deadline === 'number'
          ? exam.timePolicy!.deadline!
          : (typeof startedAt === 'number' && typeof exam.timePolicy?.durationMin === 'number'
              ? startedAt + exam.timePolicy!.durationMin! * 60_000
              : Date.now());
        submission.lateMs = Math.max(0, Date.now() - base);
      }
    } else {
      const now = Date.now();
      const v = evaluateSubmitTime(exam, typeof startedAt === 'number' ? startedAt : undefined);
      submission = {
        id: generateId(),
        examId,
        studentId,
        status: 'submitted',
        submittedAt: now,
        answers,
        isLate: v.isLate,
        lateMs: v.isLate
          ? Math.max(0, now - (typeof exam.timePolicy?.deadline === 'number'
              ? exam.timePolicy!.deadline!
              : (typeof startedAt === 'number' && typeof exam.timePolicy?.durationMin === 'number'
                  ? startedAt + exam.timePolicy!.durationMin! * 60_000
                  : now)))
          : undefined,
      };
      submissions.push(submission);
    }

    await db.saveCollection('submissions', submissions);
    await db.appendLog({
      userId: studentId,
      role: 'student',
      action: 'submit',
      targetType: 'exam',
      targetId: examId,
      detail: { examId, examTitle: exam.title, isLate: submission.isLate || false },
    });
    res.json({ message: '作答已成功提交！等待老师批改 🎊', data: submission });
  } catch (error) {
    console.error('学生提交答卷错误：', error);
    res.status(500).json({ message: '提交答题失败，请重试' });
  }
};

// 5. 教师/家长：获取特定试卷的详情和具体提交数据（三层叠加渲染所需）
export const getSubmissionDetails = async (req: AuthRequest, res: Response) => {
  const { examId, studentId } = req.params;
  const userId = req.user!.id;
  const role = req.user!.role;

  try {
    const exams = await db.getCollection('exams');
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
      return res.status(404).json({ message: '未找到该试卷' });
    }

    const submissions = await db.getCollection('submissions');
    const submission = submissions.find(s => s.examId === examId && s.studentId === studentId);

    // 校验鉴权：教师必须是该试卷的创建者，家长必须是该学生的家长，学生必须是本人
    if (role === 'teacher' && exam.teacherId !== userId) {
      return res.status(403).json({ message: '您无权查看此试卷的学生提交' });
    }
    if (role === 'parent') {
      const parent = await db.findUserById(userId);
      if (!parent || parent.childId !== studentId) {
        return res.status(403).json({ message: '您无权查看非自己孩子的提交' });
      }
    }
    if (role === 'student' && studentId !== userId) {
      return res.status(403).json({ message: '您无权查看其他学生的提交' });
    }

    // 查找学生姓名，便于页面展示
    const users = await db.getCollection('users');
    const studentUser = users.find(u => u.id === studentId);

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        pages: exam.pages,
        totalPages: exam.totalPages,
        timePolicy: exam.timePolicy || null,
        closed: !!exam.closed,
      },
      student: studentUser ? { id: studentUser.id, name: studentUser.name } : null,
      submission: submission || null, // 若未开始或未提交，则返回 null
    });
  } catch (error) {
    console.error('获取答卷详情错误：', error);
    res.status(500).json({ message: '获取答卷详情失败' });
  }
};

// 6. 教师：对学生提交的答卷进行红笔批改与评分
export const gradeSubmission = async (req: AuthRequest, res: Response) => {
  const { submissionId } = req.params;
  const { score, comment, teacherAnnotations, dimensionScores } = req.body; // annotations: Array of { pageIndex: number, canvasData: string }
  const teacherId = req.user!.id;

  if (score === undefined || !teacherAnnotations) {
    return res.status(400).json({ message: '请输入分数并上传红笔批改涂鸦' });
  }

  try {
    const submissions = await db.getCollection('submissions');
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) {
      return res.status(404).json({ message: '未找到该答卷提交记录' });
    }

    const exams = await db.getCollection('exams');
    const exam = exams.find(e => e.id === submission.examId);
    if (!exam || exam.teacherId !== teacherId) {
      return res.status(403).json({ message: '您无权批改此份试卷' });
    }

    // 防伪分享码：首次批改时生成，之后保持不变
    if (!submission.shareCode) {
      submission.shareCode = Math.random().toString(36).substring(2, 6).toUpperCase()
        + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    // 多维能力评分（雷达图）；若未提供则回退为总分单维
    submission.dimensionScores = Array.isArray(dimensionScores) && dimensionScores.length > 0
      ? dimensionScores
      : [{ key: 'total', label: '综合', score: Number(score), full: 100 }];

    submission.score = Number(score);
    submission.comment = comment || '';
    submission.teacherAnnotations = teacherAnnotations;
    submission.gradedAt = Date.now();
    submission.status = 'graded';

    await db.saveCollection('submissions', submissions);
    await db.appendLog({
      userId: teacherId,
      role: 'teacher',
      action: 'grade',
      targetType: 'exam',
      targetId: submission.examId,
      detail: { examId: submission.examId, examTitle: exam.title, score: Number(score) },
    });
    res.json({ message: '批改完成！成绩已发布 📝', data: submission });
  } catch (error) {
    console.error('批改试卷错误：', error);
    res.status(500).json({ message: '批改失败，请稍后重试' });
  }
};

// 7. 家长：获取孩子的学习报告历史
export const getChildReports = async (req: AuthRequest, res: Response) => {
  const parentId = req.user!.id;

  try {
    const users = await db.getCollection('users');
    const parent = users.find(u => u.id === parentId);
    if (!parent || !parent.childId) {
      return res.status(400).json({ message: '尚未绑定您的孩子，请先在账户设置中绑定' });
    }

    const child = users.find(u => u.id === parent.childId);
    const childName = child ? child.name : '您的孩子';

    const submissions = await db.getCollection('submissions');
    const childSubmissions = submissions.filter(s => s.studentId === parent.childId);

    const exams = await db.getCollection('exams');

    // 拼装家长看的简易报表
    const reports = childSubmissions.map(sub => {
      const exam = exams.find(e => e.id === sub.examId);
      return {
        submissionId: sub.id,
        examId: sub.examId,
        studentId: sub.studentId,
        childName,
        examTitle: exam ? exam.title : '未知试卷',
        status: sub.status,
        submittedAt: sub.submittedAt,
        gradedAt: sub.gradedAt,
        score: sub.score,
        comment: sub.comment,
      };
    });

    res.json(reports);
  } catch (error) {
    console.error('家长获取学习报告错误：', error);
    res.status(500).json({ message: '获取学习报告列表失败' });
  }
};

// 8. 教师：一键撤回已发布试卷
export const deleteExam = async (req: AuthRequest, res: Response) => {
  const { examId } = req.params;
  const teacherId = req.user!.id;

  try {
    const exams = await db.getCollection('exams');
    const examIndex = exams.findIndex(e => e.id === examId);
    
    if (examIndex === -1) {
      return res.status(404).json({ message: '未找到该试卷' });
    }

    const exam = exams[examIndex];
    if (exam.teacherId !== teacherId) {
      return res.status(403).json({ message: '您无权撤回非本人发布的试卷' });
    }

    // 从 exams 中删除该试卷
    exams.splice(examIndex, 1);
    await db.saveCollection('exams', exams);

    // 同步级联删除 submissions 中所有该试卷的答题记录
    const submissions = await db.getCollection('submissions');
    const updatedSubmissions = submissions.filter(s => s.examId !== examId);
    await db.saveCollection('submissions', updatedSubmissions);

    res.json({ message: '试卷撤回成功，相关答题数据已级联清除' });
  } catch (error) {
    console.error('撤回试卷错误：', error);
    res.status(500).json({ message: '撤回试卷失败，请稍后重试' });
  }
};

