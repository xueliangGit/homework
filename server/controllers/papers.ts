import { Response } from 'express';
import { randomUUID } from 'crypto';
import { db, Paper, Segment } from '../db';
import { AuthRequest } from '../middleware/auth';

const VALID_SEGMENTS: Segment[] = ['you', 'xiao', 'zhong'];

// 1. 教师：新建预存试卷
export const createPaper = async (req: AuthRequest, res: Response) => {
  const { title, segment, subject, tags, pages, status } = req.body;
  const ownerId = req.user!.id;

  if (!title || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ message: '请提供试卷标题并至少包含一页内容' });
  }
  const seg: Segment = VALID_SEGMENTS.includes(segment) ? segment : 'xiao';

  try {
    const paper: Paper = {
      id: randomUUID(),
      title,
      ownerId,
      segment: seg,
      subject: subject || 'general',
      tags: Array.isArray(tags) ? tags : [],
      pages,
      status: status === 'archived' ? 'archived' : 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.insertOne('papers', paper);
    await db.appendLog({
      userId: ownerId,
      role: req.user!.role,
      action: 'create_paper',
      targetType: 'paper',
      targetId: paper.id,
      detail: title,
    });
    res.status(201).json({ message: '试卷已存入试卷库', data: paper });
  } catch (e) {
    console.error('新建试卷错误：', e);
    res.status(500).json({ message: '新建试卷失败，请稍后重试' });
  }
};

// 2. 教师：列出自己的预存试卷（不含回收站）
export const listPapers = async (req: AuthRequest, res: Response) => {
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const mine = all.filter((p) => p.ownerId === req.user!.id && p.status !== 'archived');
    mine.sort((a, b) => b.updatedAt - a.updatedAt);
    // 列表不返回大体积 pages，仅摘要
    const summary = mine.map(({ pages, ...rest }) => ({ ...rest, pageCount: pages.length }));
    res.json({ data: summary });
  } catch (e) {
    console.error('列出试卷错误：', e);
    res.status(500).json({ message: '获取试卷列表失败' });
  }
};

// 3. 教师：获取单份试卷（含 pages）
export const getPaper = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const paper = all.find((p) => p.id === id && p.ownerId === req.user!.id);
    if (!paper) return res.status(404).json({ message: '未找到该试卷' });
    res.json({ data: paper });
  } catch (e) {
    console.error('获取试卷错误：', e);
    res.status(500).json({ message: '获取试卷失败' });
  }
};

// 4. 教师：更新试卷
export const updatePaper = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, segment, subject, tags, pages, status } = req.body;
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const idx = all.findIndex((p) => p.id === id && p.ownerId === req.user!.id);
    if (idx === -1) return res.status(404).json({ message: '未找到该试卷' });

    const cur = all[idx];
    const updated: Paper = {
      ...cur,
      title: title ?? cur.title,
      segment: VALID_SEGMENTS.includes(segment) ? segment : cur.segment,
      subject: subject ?? cur.subject,
      tags: Array.isArray(tags) ? tags : cur.tags,
      pages: Array.isArray(pages) ? pages : cur.pages,
      status: status ?? cur.status,
      updatedAt: Date.now(),
    };
    all[idx] = updated;
    await db.saveCollection('papers', all);
    await db.appendLog({
      userId: req.user!.id,
      role: req.user!.role,
      action: 'update_paper',
      targetType: 'paper',
      targetId: id,
      detail: updated.title,
    });
    res.json({ message: '试卷已更新', data: updated });
  } catch (e) {
    console.error('更新试卷错误：', e);
    res.status(500).json({ message: '更新试卷失败' });
  }
};

// 5. 教师：软删除（移入回收站）
export const deletePaper = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const idx = all.findIndex((p) => p.id === id && p.ownerId === req.user!.id);
    if (idx === -1) return res.status(404).json({ message: '未找到该试卷' });
    all[idx] = { ...all[idx], status: 'archived', updatedAt: Date.now() };
    await db.saveCollection('papers', all);
    await db.appendLog({
      userId: req.user!.id,
      role: req.user!.role,
      action: 'delete_paper',
      targetType: 'paper',
      targetId: id,
    });
    res.json({ message: '试卷已移入回收站' });
  } catch (e) {
    console.error('删除试卷错误：', e);
    res.status(500).json({ message: '删除试卷失败' });
  }
};

// 6. 教师：从回收站恢复
export const restorePaper = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const idx = all.findIndex((p) => p.id === id && p.ownerId === req.user!.id);
    if (idx === -1) return res.status(404).json({ message: '未找到该试卷' });
    all[idx] = { ...all[idx], status: 'draft', updatedAt: Date.now() };
    await db.saveCollection('papers', all);
    res.json({ message: '试卷已恢复' });
  } catch (e) {
    console.error('恢复试卷错误：', e);
    res.status(500).json({ message: '恢复试卷失败' });
  }
};

// 7. 教师：回收站列表
export const listArchivedPapers = async (req: AuthRequest, res: Response) => {
  try {
    const all = (await db.getCollection('papers')) as Paper[];
    const archived = all
      .filter((p) => p.ownerId === req.user!.id && p.status === 'archived')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ pages, ...rest }) => ({ ...rest, pageCount: pages.length }));
    res.json({ data: archived });
  } catch (e) {
    console.error('列出回收站错误：', e);
    res.status(500).json({ message: '获取回收站失败' });
  }
};
