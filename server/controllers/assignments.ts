import { Response } from 'express';
import { randomUUID } from 'crypto';
import { db, Assignment, Exam, Paper, Segment, TimePolicy, SplitConfig } from '../db';
import { AuthRequest } from '../middleware/auth';

const VALID_SEGMENTS: Segment[] = ['you', 'xiao', 'zhong'];

// 把关：校验时限策略合法性，缺省为宽松无限制
function normalizeTimePolicy(input: any): TimePolicy {
  const tp: TimePolicy = { mode: 'grace' };
  if (!input || typeof input !== 'object') return tp;

  tp.mode = input.mode === 'strict' ? 'strict' : 'grace';
  if (typeof input.deadline === 'number' && input.deadline > 0) {
    tp.deadline = input.deadline;
  }
  if (typeof input.durationMin === 'number' && input.durationMin > 0) {
    tp.durationMin = input.durationMin;
  }
  if (typeof input.latePenalty === 'number' && input.latePenalty >= 0) {
    tp.latePenalty = input.latePenalty;
  }
  // 每日可作答时段（"HH:MM"），格式非法则忽略（视为当天随时可做）
  if (input.dailyWindow && typeof input.dailyWindow.start === 'string' && typeof input.dailyWindow.end === 'string') {
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (re.test(input.dailyWindow.start) && re.test(input.dailyWindow.end)) {
      tp.dailyWindow = { start: input.dailyWindow.start, end: input.dailyWindow.end };
    }
  }
  return tp;
}

// "HH:MM" → 当天分钟数；非法返回 null
function toMinutesOfDay(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 当前时间是否在每日可作答时段内（支持跨午夜，如 22:00-07:00）
function isWithinDailyWindow(win: { start: string; end: string }, now: number): boolean {
  const start = toMinutesOfDay(win.start);
  const end = toMinutesOfDay(win.end);
  if (start === null || end === null) return true; // 格式非法不限制
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end; // 跨午夜
}

// 评估某学生此刻能否提交：返回 { allowed, isLate, reason }
export function evaluateSubmitTime(exam: Exam, startedAt: number | undefined) {
  const tp = exam.timePolicy;
  const now = Date.now();
  if (exam.closed) {
    return { allowed: false, isLate: false, reason: '本作业已被老师关闭，无法再提交' };
  }
  if (!tp) return { allowed: true, isLate: false, reason: '' };

  // 0) 每日可作答时段（不设为当天随时可做）
  if (tp.dailyWindow && tp.dailyWindow.start && tp.dailyWindow.end) {
    if (!isWithinDailyWindow(tp.dailyWindow, now)) {
      return {
        allowed: false,
        isLate: false,
        reason: `今日可作答时段为 ${tp.dailyWindow.start}-${tp.dailyWindow.end}，现在不在该时段内`,
      };
    }
  }

  let isLate = false;
  // 1) 截止时间
  if (typeof tp.deadline === 'number') {
    if (now > tp.deadline) {
      if (tp.mode === 'strict') {
        return { allowed: false, isLate: false, reason: '已超过截止时间，无法提交' };
      }
      isLate = true;
    }
  }
  // 2) 倒计时作答时长（以客户端记录的开始时间为准）
  if (typeof tp.durationMin === 'number' && typeof startedAt === 'number') {
    const limit = startedAt + tp.durationMin * 60_000;
    if (now > limit) {
      if (tp.mode === 'strict') {
        return { allowed: false, isLate: false, reason: '作答时间已耗尽，无法提交' };
      }
      isLate = true;
    }
  }
  return { allowed: true, isLate, reason: '' };
}

// 计算分页分堆：返回每堆的 [start,end]（0-based 闭区间）
function buildPageGroups(totalPages: number, split: SplitConfig): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = [];
  if (split.mode === 'custom' && Array.isArray(split.sizes) && split.sizes.length > 0) {
    let cursor = 0;
    for (const raw of split.sizes) {
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (cursor >= totalPages) break;
      const take = Math.min(n, totalPages - cursor);
      groups.push({ start: cursor, end: cursor + take - 1 });
      cursor += take;
    }
    if (cursor < totalPages) groups.push({ start: cursor, end: totalPages - 1 });
  } else {
    const size = Math.max(1, Math.floor(Number(split.size) || 1));
    for (let cursor = 0; cursor < totalPages; cursor += size) {
      groups.push({ start: cursor, end: Math.min(cursor + size - 1, totalPages - 1) });
    }
  }
  return groups;
}

// 教师：从预存试卷发布作业（可整卷一份，或按页批量分堆、自动排期）
export const publishAssignment = async (req: AuthRequest, res: Response) => {
  const { paperId, classIds, title, description, timePolicy, theme, allowRedo, maxRedo, split } =
    req.body;
  const teacherId = req.user!.id;

  if (!paperId || !Array.isArray(classIds) || classIds.length === 0) {
    return res.status(400).json({ message: '请选择一份预存试卷，并至少指定一个发布班级' });
  }

  try {
    const papers = (await db.getCollection('papers')) as Paper[];
    const paper = papers.find((p) => p.id === paperId && p.ownerId === teacherId);
    if (!paper) {
      return res.status(404).json({ message: '未找到该预存试卷，或它不是您创建的' });
    }
    if (paper.status === 'archived') {
      return res.status(400).json({ message: '该试卷在回收站中，请先恢复后再发布' });
    }

    const classes = await db.getCollection('classes');
    const ownedClasses = classes.filter((c) => c.teacherId === teacherId);
    const invalid = classIds.filter((cid: string) => !ownedClasses.some((c) => c.id === cid));
    if (invalid.length > 0) {
      return res.status(403).json({ message: '存在您无权发布的班级' });
    }

    // 预存卷页可能是 {data,width,height} 对象或纯字符串，统一抽成 Base64 串
    const allPages: string[] = (paper.pages || [])
      .map((pg: any) => (typeof pg === 'string' ? pg : pg?.data))
      .filter(Boolean);
    if (allPages.length === 0) {
      return res.status(400).json({ message: '该预存试卷没有任何页面内容' });
    }

    const tp = normalizeTimePolicy(timePolicy);
    const seg: Segment = VALID_SEGMENTS.includes(theme?.segment) ? theme.segment : paper.segment;
    const finalTheme = { segment: seg, subject: theme?.subject || paper.subject || 'general' };
    const baseTitle = title?.trim() || paper.title;

    // 解析分页分堆配置
    let groups: { start: number; end: number }[] | null = null;
    const sp = split as SplitConfig | undefined;
    if (sp && (sp.mode === 'uniform' || sp.mode === 'custom')) {
      groups = buildPageGroups(allPages.length, sp);
    }

    const newExams: Exam[] = [];
    const newAssignments: Assignment[] = [];

    const makeOne = (gTitle: string, gPages: string[], gTp: TimePolicy) => {
      const assignmentId = randomUUID();
      const examIds: string[] = [];
      for (const cid of classIds) {
        const ex: Exam = {
          id: randomUUID(),
          title: gTitle,
          teacherId,
          classId: cid,
          createdAt: Date.now(),
          totalPages: gPages.length,
          pages: gPages,
          timePolicy: gTp,
          theme: finalTheme,
          paperId,
          assignmentId,
        };
        newExams.push(ex);
        examIds.push(ex.id);
      }
      const a: Assignment = {
        id: assignmentId,
        paperId,
        title: gTitle,
        teacherId,
        classIds,
        examIds,
        description: description?.trim() || '',
        timePolicy: gTp,
        theme: finalTheme,
        allowRedo: allowRedo ?? true,
        maxRedo: typeof maxRedo === 'number' ? maxRedo : undefined,
        status: 'published',
        createdAt: Date.now(),
      };
      newAssignments.push(a);
    };

    if (groups && groups.length) {
      const startDate =
        typeof sp!.startDate === 'number' && sp!.startDate > 0
          ? sp!.startDate
          : Date.now() + 86_400_000;
      const intervalMs = Math.max(0, Number(sp!.intervalDays) || 1) * 86_400_000;
      groups.forEach((g, i) => {
        const gPages = allPages.slice(g.start, g.end + 1);
        const gTp: TimePolicy = { ...tp, deadline: startDate + i * intervalMs };
        const gTitle = `${baseTitle}（第${i + 1}份 · 第${g.start + 1}-${g.end + 1}页）`;
        makeOne(gTitle, gPages, gTp);
      });
    } else {
      makeOne(baseTitle, allPages, tp);
    }

    const examsCol = (await db.getCollection('exams')) as Exam[];
    examsCol.push(...newExams);
    await db.saveCollection('exams', examsCol);
    for (const a of newAssignments) await db.insertOne('assignments', a);

    await db.appendLog({
      userId: teacherId,
      role: req.user!.role,
      action: 'publish_assignment',
      targetType: 'assignment',
      targetId: newAssignments[0].id,
      detail: `${baseTitle} → ${newAssignments.length} 份作业 / ${classIds.length} 个班级`,
    });

    res.status(201).json({
      message: `已批量发布 ${newAssignments.length} 份作业到 ${classIds.length} 个班级 🎉`,
      data: { assignments: newAssignments, count: newAssignments.length },
    });
  } catch (e) {
    console.error('发布作业错误：', e);
    res.status(500).json({ message: '发布作业失败，请稍后重试' });
  }
};

// 教师：作业发布管理列表（含班级名、时限、进度）
export const listAssignments = async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id;
  try {
    const assignments = (await db.getCollection('assignments')) as Assignment[];
    const mine = assignments
      .filter((a) => a.teacherId === teacherId)
      .sort((a, b) => b.createdAt - a.createdAt);

    const classes = await db.getCollection('classes');
    const submissions = await db.getCollection('submissions');

    const result = mine.map((a) => {
      const classNames = a.classIds
        .map((cid) => classes.find((c) => c.id === cid)?.name)
        .filter(Boolean) as string[];
      const submitted = submissions.filter(
        (s) => a.examIds.includes((s as any).examId)
      ).length;
      return {
        id: a.id,
        title: a.title,
        paperId: a.paperId,
        classIds: a.classIds,
        classNames,
        examIds: a.examIds,
        examCount: a.examIds.length,
        submittedCount: submitted,
        timePolicy: a.timePolicy,
        theme: a.theme,
        status: a.status,
        createdAt: a.createdAt,
      };
    });

    res.json({ data: result });
  } catch (e) {
    console.error('列出作业错误：', e);
    res.status(500).json({ message: '获取作业列表失败' });
  }
};

// 教师：关闭作业（级联关闭其下所有 Exam，学生无法再作答）
export const closeAssignment = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const teacherId = req.user!.id;
  try {
    const assignments = (await db.getCollection('assignments')) as Assignment[];
    const idx = assignments.findIndex((a) => a.id === id && a.teacherId === teacherId);
    if (idx === -1) return res.status(404).json({ message: '未找到该作业' });

    assignments[idx] = { ...assignments[idx], status: 'closed' };
    await db.saveCollection('assignments', assignments);

    const exams = await db.getCollection('exams');
    let changed = false;
    for (const ex of exams) {
      if (ex.assignmentId === id && !ex.closed) {
        ex.closed = true;
        changed = true;
      }
    }
    if (changed) await db.saveCollection('exams', exams);

    await db.appendLog({
      userId: teacherId,
      role: req.user!.role,
      action: 'close_assignment',
      targetType: 'assignment',
      targetId: id,
    });

    res.json({ message: '作业已关闭，学生将无法继续作答' });
  } catch (e) {
    console.error('关闭作业错误：', e);
    res.status(500).json({ message: '关闭作业失败' });
  }
};

// 教师：重开作业
export const reopenAssignment = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const teacherId = req.user!.id;
  try {
    const assignments = (await db.getCollection('assignments')) as Assignment[];
    const idx = assignments.findIndex((a) => a.id === id && a.teacherId === teacherId);
    if (idx === -1) return res.status(404).json({ message: '未找到该作业' });

    assignments[idx] = { ...assignments[idx], status: 'published' };
    await db.saveCollection('assignments', assignments);

    const exams = await db.getCollection('exams');
    let changed = false;
    for (const ex of exams) {
      if (ex.assignmentId === id && ex.closed) {
        ex.closed = false;
        changed = true;
      }
    }
    if (changed) await db.saveCollection('exams', exams);

    res.json({ message: '作业已重新开放' });
  } catch (e) {
    console.error('重开作业错误：', e);
    res.status(500).json({ message: '重开作业失败' });
  }
};
