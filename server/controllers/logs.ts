import { Response } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/auth';

// 教师：全链路操作记录（审计留痕）
// 返回与当前教师相关的全部操作日志：自己发起的，以及名下资源（试卷/作业/班级/学生提交）上的动作
export const listLogs = async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id;
  try {
    const [logs, papers, assignments, exams, classes] = await Promise.all([
      db.getCollection('operationLogs'),
      db.getCollection('papers'),
      db.getCollection('assignments'),
      db.getCollection('exams'),
      db.getCollection('classes'),
    ]);

    const myPaperIds = new Set((papers as any[]).filter((p) => p.ownerId === teacherId).map((p) => p.id));
    const myAssignmentIds = new Set((assignments as any[]).filter((a) => a.teacherId === teacherId).map((a) => a.id));
    const myExamIds = new Set((exams as any[]).filter((e) => e.teacherId === teacherId).map((e) => e.id));
    const myClassIds = new Set((classes as any[]).filter((c) => c.teacherId === teacherId).map((c) => c.id));

    const scoped = (logs as any[])
      .filter((l) => {
        if (l.userId === teacherId) return true;
        if (l.targetType === 'paper' && myPaperIds.has(l.targetId)) return true;
        if (l.targetType === 'assignment' && myAssignmentIds.has(l.targetId)) return true;
        if (l.targetType === 'exam' && myExamIds.has(l.targetId)) return true;
        if (l.targetType === 'class' && myClassIds.has(l.targetId)) return true;
        // 学生提交/批改动作：其 examId 归属教师
        if ((l.action === 'submit' || l.action === 'grade' || l.action === 'revise_grade') && l.detail?.examId && myExamIds.has(l.detail.examId)) return true;
        return false;
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 200)
      .map((l) => ({
        id: l.id,
        at: l.at,
        action: l.action,
        role: l.role,
        userId: l.userId,
        targetType: l.targetType,
        targetId: l.targetId,
        detail: l.detail,
        ip: l.ip,
        device: l.device,
      }));

    res.json({ data: scoped });
  } catch (e) {
    console.error('获取操作日志错误：', e);
    res.status(500).json({ message: '获取记录失败' });
  }
};
