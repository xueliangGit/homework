import { Response } from 'express';
import { randomUUID } from 'crypto';
import { db, Exam, Submission, User, Assignment } from '../db';
import { AuthRequest } from '../middleware/auth';
import { evaluateSubmitTime } from './assignments';

const generateId = () => Math.random().toString(36).substring(2, 11);

// 按 pageIndex 合并答案：覆盖已有页、删除空白页（canvasData 为空），便于分页自动存盘互不覆盖
function mergeAnswers(
  existing: { pageIndex: number; canvasData: string }[] = [],
  incoming: { pageIndex: number; canvasData: string }[] = []
): { pageIndex: number; canvasData: string }[] {
  const map = new Map<number, string>();
  for (const a of existing) {
    if (a && typeof a.canvasData === 'string' && a.canvasData !== '') map.set(a.pageIndex, a.canvasData);
  }
  for (const a of incoming) {
    if (!a || typeof a.canvasData !== 'string') continue;
    if (a.canvasData === '') map.delete(a.pageIndex);
    else map.set(a.pageIndex, a.canvasData);
  }
  return Array.from(map.entries()).map(([pageIndex, canvasData]) => ({ pageIndex, canvasData }));
}

// 1. 教师：发布试卷
export const createExam = async (req: AuthRequest, res: Response) => {
  const { title, classId, pages, timePolicy, theme, allowRedo, description } = req.body;
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

    // 收敛发布模型：不论从「发布作业」还是「试卷库」入口，都写一条 linked assignment，
    // 使 submitExam 的 allowRedo / 时限策略对两条路径产出一致的学生体验。
    const assignmentId = randomUUID();
    const newExam: Exam = {
      id: generateId(),
      title,
      teacherId,
      classId,
      createdAt: Date.now(),
      totalPages: pages.length,
      pages, // 页面 Base64 数据数组
      timePolicy: timePolicy || undefined,
      theme: theme || undefined,
      assignmentId,
    };

    const exams = await db.getCollection('exams');
    exams.push(newExam);
    await db.saveCollection('exams', exams);

    const assignment: Assignment = {
      id: assignmentId,
      paperId: '', // 「发布作业」入口无预存卷，留空
      title,
      teacherId,
      classIds: [classId],
      examIds: [newExam.id],
      description: description?.trim() || '',
      timePolicy: timePolicy || { mode: 'grace' },
      theme: theme || undefined,
      allowRedo: allowRedo ?? true,
      status: 'published',
      createdAt: Date.now(),
    };
    await db.insertOne('assignments', assignment);
    await db.appendLog({
      userId: teacherId,
      role: req.user!.role,
      action: 'publish_assignment',
      targetType: 'assignment',
      targetId: assignmentId,
      detail: `${title} → 1 份作业 / 1 个班级（发布作业入口）`,
    });

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
    const submissions = await db.getCollection('submissions');

    // 可见作业 = 当前所在班的作业 ∪ 该生所有历史提交(含草稿)涉及的作业。
    // 这样转班/升班后，旧班里「写过/有草稿」的作业仍可见、可续写，不会丢历史。
    const currentClassExamIds = exams
      .filter(e => classIds.includes(e.classId))
      .map(e => e.id);
    const historyExamIds = submissions
      .filter(s => s.studentId === studentId)
      .map(s => s.examId);
    const visibleExamIds = new Set([...currentClassExamIds, ...historyExamIds]);
    const studentExams = exams.filter(e => visibleExamIds.has(e.id));

    // 联合查询，附带学生的完成进度
    const result = studentExams.map(exam => {
      const submission = submissions.find(s => s.examId === exam.id && s.studentId === studentId);

      // 班级名优先用答卷自身快照（转班/退班/班级被删后仍稳定），回退到 exam.classId 反查
      const teacherClass = classes.find(c => c.id === exam.classId);
      const className = active?.className || (teacherClass ? teacherClass.name : '未知班级');

      // P2-8 订正：存在 redoOf 记录时，列表以订正版为准
      const redoSub = submission ? submissions.find(s => s.redoOf === submission.id) : undefined;
      const active = redoSub || submission;

      return {
        id: exam.id,
        title: exam.title,
        classId: exam.classId,
        className,
        createdAt: exam.createdAt,
        totalPages: exam.totalPages,
        // 状态：unstarted | drafting(仅存草稿未交) | submitted | graded
        status: active
          ? active.status === 'draft' ? 'drafting' : active.status
          : 'unstarted',
        lastSavedAt: active?.lastSavedAt,
        draftPages: active?.draftPages,
        score: active?.score,
        comment: active?.comment,
        submissionId: active?.id,
        redoSubmissionId: redoSub?.id,
        canRedo: !!submission && submission.status === 'graded' && !redoSub,
        timePolicy: exam.timePolicy || null,
        closed: !!exam.closed,
        theme: exam.theme || null,
        isLate: active?.isLate || false,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('学生获取试卷错误：', error);
    res.status(500).json({ message: '获取作业列表失败' });
  }
};

// 3.5 学生：云端同步草稿（仅手动「同步到云端」触发，按 examId+studentId upsert，status='draft'）
export const saveDraft = async (req: AuthRequest, res: Response) => {
  const { examId } = req.params;
  const { answers, currentPage, clientVersion, redo, force } = req.body; // answers: Array<{ pageIndex, canvasData }>
  const studentId = req.user!.id;

  if (!Array.isArray(answers)) {
    return res.status(400).json({ message: '草稿笔迹格式不正确' });
  }

  try {
    // 安全校验：学生必须属于该试卷对应的班级
    const exams = await db.getCollection('exams');
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
      return res.status(404).json({ message: '未找到该试卷' });
    }

    const submissions = await db.getCollection('submissions');
    // 已参与过该作业（有草稿/提交记录）→ 允许续写，不受转班/升班影响
    const alreadyParticipated = submissions.some(
      s => s.examId === examId && s.studentId === studentId
    );
    const classes = await db.getCollection('classes');
    const examClass = classes.find(c => c.id === exam.classId);
    if (!alreadyParticipated && (!examClass || !examClass.studentIds.includes(studentId))) {
      return res.status(403).json({ message: '您不属于该试卷对应的班级，无法保存草稿' });
    }

    // 班级快照：同 submitExam，优先取学生真实所属班，回退 exam.classId
    const studentClass = classes.find(
      c => c.studentIds.includes(studentId) &&
        (c.id === exam.classId || (exam.classIds || []).includes(c.id))
    );
    const snapClass = studentClass || examClass;
    const snapClassId = snapClass?.id;
    const snapClassName = snapClass?.name;

    // 权益校验：云端同步草稿为可收费功能，无 cloud_sync 权益则拦截（缺省视为已开通）
    const user = await db.findUserById(studentId);
    if (user && user.entitlements && user.entitlements.cloud_sync === false) {
      return res.status(402).json({ message: '☁️ 云端同步草稿是会员功能，请先开通后再同步哦' });
    }

    const now = Date.now();
    let draft = submissions.find(s => s.examId === examId && s.studentId === studentId);

    // P2-8 订正：graded 后带 redo=true 写订正草稿（复用 redoOf 记录），不改原批改答卷
    if (draft && draft.status === 'graded' && redo === true) {
      let redoSub = submissions.find(s => s.redoOf === draft!.id);
      if (!redoSub) {
        redoSub = {
          id: generateId(),
          examId,
          studentId,
          status: 'draft',
          submittedAt: now,
          answers: [],
          redoOf: draft.id,
          version: 1,
          classId: snapClassId,
          className: snapClassName,
        };
        submissions.push(redoSub);
      }
      draft = redoSub;
    }

    if (draft) {
      if (draft.status === 'graded' && redo !== true) {
        return res.status(400).json({ message: '老师已经批改完成，无法再修改草稿' });
      }
      // P2-14 并发锁：他人已保存更新版本时提示冲突（除非强制覆盖）
      if (
        typeof draft.version === 'number' && typeof clientVersion === 'number' &&
        clientVersion >= 0 && draft.version > clientVersion && !force
      ) {
        return res.status(409).json({
          message: '检测到这份作业在别的设备上有更新的保存，是否仍用当前内容覆盖？',
          conflict: true,
          serverVersion: draft.version,
        });
      }
      draft.answers = mergeAnswers(draft.answers, answers);
      draft.status = 'draft';
      draft.lastSavedAt = now;
      draft.version = (typeof draft.version === 'number' ? draft.version : 0) + 1;
      draft.classId = snapClassId;
      draft.className = snapClassName;
      if (typeof currentPage === 'number') draft.draftPages = currentPage + 1;
    } else {
      draft = {
        id: generateId(),
        examId,
        studentId,
        status: 'draft',
        submittedAt: now,
        answers: mergeAnswers([], answers),
        lastSavedAt: now,
        draftPages: typeof currentPage === 'number' ? currentPage + 1 : undefined,
        version: 1,
        classId: snapClassId,
        className: snapClassName,
      };
      submissions.push(draft);
    }

    await db.saveCollection('submissions', submissions);
    res.json({ message: '草稿已安全保存到云端 ☁️', data: { lastSavedAt: now, version: draft.version } });
  } catch (error) {
    console.error('保存草稿错误：', error);
    res.status(500).json({ message: '草稿保存失败，请稍后再试' });
  }
};

// 4. 学生：直接提交答卷（画布涂鸦）
export const submitExam = async (req: AuthRequest, res: Response) => {
  const { examId } = req.params;
  const { answers, startedAt, clientVersion, redo, force } = req.body; // Array of { pageIndex, canvasData }
  const studentId = req.user!.id;

  if (!answers || !Array.isArray(answers)) {
    return res.status(400).json({ message: '答卷涂鸦笔迹不能为空' });
  }
  // P2-7 拦截空卷：过滤出有效笔迹页，0 页则不接受提交
  const validAnswers = answers.filter(
    (a: any) => a && typeof a.canvasData === 'string' && a.canvasData !== ''
  );
  if (validAnswers.length === 0) {
    return res.status(400).json({ message: '请先在本子上写点内容，再交给老师批改哦 ✏️' });
  }

  try {
    // 安全校验：学生必须属于该试卷对应的班级，防止提交到任意试卷
    const exams = await db.getCollection('exams');
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
      return res.status(404).json({ message: '未找到该试卷' });
    }
    // 安全校验：学生必须是当前班成员，或已参与过该作业（转班/升班后仍可续写与提交自己的草稿）
    const submissions = await db.getCollection('submissions');
    const alreadyParticipated = submissions.some(
      s => s.examId === examId && s.studentId === studentId
    );
    const classes = await db.getCollection('classes');
    const examClass = classes.find(c => c.id === exam.classId);
    if (!alreadyParticipated && (!examClass || !examClass.studentIds.includes(studentId))) {
      return res.status(403).json({ message: '您不属于该试卷对应的班级，无法提交此答卷' });
    }

    // 班级快照：优先取学生真实所属班（可能在 exam.classIds 多班之一），回退到 exam.classId。
    // 转班/退班甚至班级被删后，历史作业仍能显示其提交时的所属班级名（P2 收尾项）。
    const studentClass = classes.find(
      c => c.studentIds.includes(studentId) &&
        (c.id === exam.classId || (exam.classIds || []).includes(c.id))
    );
    const snapClass = studentClass || examClass;
    const snapClassId = snapClass?.id;
    const snapClassName = snapClass?.name;

    // 时限策略校验（截止时间 / 倒计时作答时长）
    if (exam.timePolicy || exam.closed) {
      const verdict = evaluateSubmitTime(exam, typeof startedAt === 'number' ? startedAt : undefined);
      if (!verdict.allowed) {
        return res.status(403).json({ message: verdict.reason || '当前无法提交本作业' });
      }
    }

    let submission = submissions.find(s => s.examId === examId && s.studentId === studentId);

    // P2-8 订正模式：老师已批改(graded)后，学生点「订正错题」携带 redo=true 重新作答。
    // 不修改原批改答卷，而是新建/复用一条 redoOf 记录，保证原成绩留痕可查。
    if (submission && submission.status === 'graded' && redo === true) {
      let redoSub = submissions.find(s => s.redoOf === submission!.id);
      if (!redoSub) {
        const now = Date.now();
        redoSub = {
          id: generateId(),
          examId,
          studentId,
          status: 'submitted',
          submittedAt: now,
          answers: [],
          redoOf: submission.id,
          version: 1,
          classId: snapClassId,
          className: snapClassName,
        };
        submissions.push(redoSub);
      }
      submission = redoSub;
    }

    // 不允许重复提交：若该作业配置禁止重做且已提交，则拦截
    if (submission) {
      if (submission.status === 'graded' && redo !== true) {
        return res.status(400).json({ message: '老师已经完成批改，无法修改答卷' });
      }
      // P2-14 并发锁：他人已保存更新版本时提示冲突（除非强制覆盖）
      if (
        typeof submission.version === 'number' && typeof clientVersion === 'number' &&
        clientVersion >= 0 && submission.version > clientVersion && !force
      ) {
        return res.status(409).json({
          message: '检测到这份作业在别的设备上已经有更新的保存/提交，是否仍用当前设备的内容覆盖？',
          conflict: true,
          serverVersion: submission.version,
        });
      }
      // 草稿转正（draft→submitted）始终放行；仅对已提交的答卷才校验是否允许重做
      if (submission.status === 'submitted') {
        const assignments = await db.getCollection('assignments');
        const assign = assignments.find((a: any) => a.examIds?.includes(examId));
        if (assign && assign.allowRedo === false) {
          return res.status(400).json({ message: '本作业不允许重复提交，请耐心等待老师批改' });
        }
      }
      // 按页合并而非整体覆盖：避免跨设备交替作答后提交互相覆盖、丢页
      // （mergeAnswers 会保留未重画的页，空白页视为擦除）
      submission.answers = mergeAnswers(submission.answers, validAnswers);
      submission.submittedAt = Date.now();
      submission.status = 'submitted';
      submission.version = (typeof submission.version === 'number' ? submission.version : 0) + 1;
      submission.classId = snapClassId;
      submission.className = snapClassName;
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
        answers: validAnswers,
        version: 1,
        classId: snapClassId,
        className: snapClassName,
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
    let submission = submissions.find(s => s.examId === examId && s.studentId === studentId);
    // P2-8 订正模式：请求 ?redo=1 时优先返回订正记录
    if (req.query.redo === '1' && submission) {
      const redoSub = submissions.find(s => s.redoOf === submission!.id);
      if (redoSub) submission = redoSub;
    }

    // 校验鉴权：教师必须是该试卷的创建者，家长必须是该学生的家长，学生必须是本人
    if (role === 'teacher' && exam.teacherId !== userId) {
      return res.status(403).json({ message: '您无权查看此试卷的学生提交' });
    }
    if (role === 'parent') {
      const parent = await db.findUserById(userId);
      const childIds = parent?.childIds?.length
        ? parent.childIds
        : parent?.childId
        ? [parent.childId]
        : [];
      if (!parent || !childIds.includes(studentId)) {
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

    // P2-11 迟交扣分：迟交且作业配置了迟交扣分，从总分中扣除（下限 0）
    let finalScore = Number(score);
    let penalty = 0;
    if (submission.isLate && exam.timePolicy?.latePenalty && exam.timePolicy.latePenalty > 0) {
      penalty = Math.min(exam.timePolicy.latePenalty, finalScore);
      finalScore = Math.max(0, finalScore - penalty);
      submission.latePenaltyApplied = penalty;
    } else {
      submission.latePenaltyApplied = 0;
    }

    submission.score = finalScore;
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
      detail: { examId: submission.examId, examTitle: exam.title, score: finalScore, latePenalty: penalty },
    });
    res.json({
      message: penalty > 0 ? `批改完成！已扣除迟交 ${penalty} 分 📝` : '批改完成！成绩已发布 📝',
      data: submission,
    });
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
    if (!parent || (!parent.childIds?.length && !parent.childId)) {
      return res.status(400).json({ message: '尚未绑定您的孩子，请先在账户设置中绑定' });
    }
    // 解析绑定孩子列表（兼容旧单孩 childId 字段）
    const childIds = parent.childIds?.length
      ? parent.childIds
      : parent.childId
      ? [parent.childId]
      : [];

    const submissions = await db.getCollection('submissions');
    const childSubmissions = submissions.filter(s => childIds.includes(s.studentId));

    const exams = await db.getCollection('exams');

    // 拼装家长看的简易报表（支持多孩，每条带 childName/studentId 便于前端分组）
    const reports = childSubmissions.map(sub => {
      const child = users.find(u => u.id === sub.studentId);
      const exam = exams.find(e => e.id === sub.examId);
      return {
        submissionId: sub.id,
        examId: sub.examId,
        studentId: sub.studentId,
        childName: child ? child.name : '您的孩子',
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

// 9. 教师：获取各作业待批改/迟交统计（用于大厅角标与提醒）
export const getTeacherStats = async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id;
  try {
    const exams = await db.getCollection('exams');
    const submissions = await db.getCollection('submissions');
    const myExams = exams.filter(e => e.teacherId === teacherId);
    const stats: Record<string, { pending: number; late: number }> = {};
    let totalPending = 0;
    let totalLate = 0;
    for (const exam of myExams) {
      const subs = submissions.filter(s => s.examId === exam.id && s.status === 'submitted');
      const late = subs.filter(s => s.isLate).length;
      stats[exam.id] = { pending: subs.length, late };
      totalPending += subs.length;
      totalLate += late;
    }
    res.json({ stats, totalPending, totalLate });
  } catch (error) {
    console.error('获取教师统计错误：', error);
    res.status(500).json({ message: '获取统计失败' });
  }
};

