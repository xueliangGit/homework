import './env-loader';
import express, { RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { db } from './db';
import { authenticateToken, requireRole } from './middleware/auth';
import { register, login, getMe, parentBindChild, changePassword, resetPassword, checkUsername, suggestUsername } from './controllers/auth';
import { createClass, getClasses, addStudentToClass, removeStudentFromClass, exportClassGrades } from './controllers/classes';
import {
  createExam,
  getClassExams,
  getStudentExams,
  saveDraft,
  submitExam,
  getSubmissionDetails,
  gradeSubmission,
  getChildReports,
  deleteExam,
  getTeacherStats,
} from './controllers/exams';
import {
  createPaper,
  listPapers,
  getPaper,
  updatePaper,
  deletePaper,
  restorePaper,
  listArchivedPapers,
} from './controllers/papers';
import {
  publishAssignment,
  listAssignments,
  closeAssignment,
  reopenAssignment,
} from './controllers/assignments';
import { listLogs } from './controllers/logs';

const app = express();
const PORT = process.env.PORT || 4000;

// CORS：仅允许白名单来源（环境变量 CORS_ORIGIN 逗号分隔，默认本地 dev 端口）
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin（同源/服务端间调用）或白名单内来源
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS 来源不被允许'));
    }
  },
  credentials: true,
}));

// 请求体解析分档：
//  - 普通接口 10mb 上限（防大 payload 攻击）
//  - 发卷/交卷/批改三类图片型接口单独放开到 50mb（承载多页 Base64 涂鸦/红笔）
const jsonDefault = express.json({ limit: '10mb' });
const jsonImage = express.json({ limit: '50mb' });
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 简单内存速率限制（不引入额外依赖）：超过阈值返回 429
function rateLimit(windowMs: number, max: number): RequestHandler {
  const hits = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ message: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// 全局宽松限速 + 认证接口严格限速（防暴力破解）
const globalLimiter = rateLimit(15 * 60 * 1000, 200);
const authLimiter = rateLimit(15 * 60 * 1000, 10);
app.use(globalLimiter);

// 基础健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ================= AUTH ROUTES (认证路由) =================
app.post('/api/auth/register', authLimiter, jsonDefault, register);
app.post('/api/auth/login', authLimiter, jsonDefault, login);
app.get('/api/auth/me', authenticateToken, getMe);
app.post('/api/auth/parent/bind', authenticateToken, requireRole(['parent']), jsonDefault, parentBindChild);
app.post('/api/auth/change-password', authenticateToken, jsonDefault, changePassword);
app.post('/api/auth/reset-password', authLimiter, jsonDefault, resetPassword);
// 学号查重 / 自动生成建议（教师端实时校验用，P2-学生账号体验）
app.get('/api/users/check-username', authenticateToken, jsonDefault, checkUsername);
app.get('/api/users/suggest-username', authenticateToken, jsonDefault, suggestUsername);

// ================= CLASS ROUTES (班级路由) =================
app.post('/api/classes', authenticateToken, requireRole(['teacher']), jsonDefault, createClass);
app.get('/api/classes', authenticateToken, requireRole(['teacher', 'student']), getClasses);
app.post('/api/classes/:classId/students', authenticateToken, requireRole(['teacher']), jsonDefault, addStudentToClass);
app.delete('/api/classes/:classId/students/:studentId', authenticateToken, requireRole(['teacher']), removeStudentFromClass);
app.get('/api/classes/:classId/export', authenticateToken, requireRole(['teacher']), exportClassGrades);

// ================= EXAM ROUTES (试卷与答卷路由) =================
app.post('/api/exams', authenticateToken, requireRole(['teacher']), jsonImage, createExam);
app.delete('/api/exams/:examId', authenticateToken, requireRole(['teacher']), deleteExam);
app.get('/api/exams/class/:classId', authenticateToken, requireRole(['teacher']), getClassExams);
app.get('/api/exams/student', authenticateToken, requireRole(['student']), getStudentExams);
app.post('/api/exams/:examId/draft', authenticateToken, requireRole(['student']), jsonImage, saveDraft);
app.post('/api/exams/:examId/submit', authenticateToken, requireRole(['student']), jsonImage, submitExam);
app.get('/api/exams/:examId/submission/:studentId', authenticateToken, getSubmissionDetails);
app.post('/api/submissions/:submissionId/grade', authenticateToken, requireRole(['teacher']), jsonImage, gradeSubmission);
app.get('/api/parents/child/submissions', authenticateToken, requireRole(['parent']), getChildReports);
app.get('/api/teacher/stats', authenticateToken, requireRole(['teacher']), getTeacherStats);

// ================= PAPER ROUTES (预存试卷库) =================
app.post('/api/papers', authenticateToken, requireRole(['teacher']), jsonImage, createPaper);
app.get('/api/papers', authenticateToken, requireRole(['teacher']), listPapers);
app.get('/api/papers/archived', authenticateToken, requireRole(['teacher']), listArchivedPapers);
app.get('/api/papers/:id', authenticateToken, requireRole(['teacher']), getPaper);
app.put('/api/papers/:id', authenticateToken, requireRole(['teacher']), jsonImage, updatePaper);
app.post('/api/papers/:id/restore', authenticateToken, requireRole(['teacher']), restorePaper);
app.delete('/api/papers/:id', authenticateToken, requireRole(['teacher']), deletePaper);

// ================= ASSIGNMENT ROUTES (发布作业 / 时限策略) =================
app.post('/api/assignments', authenticateToken, requireRole(['teacher']), jsonImage, publishAssignment);
app.get('/api/assignments', authenticateToken, requireRole(['teacher']), listAssignments);
app.post('/api/assignments/:id/close', authenticateToken, requireRole(['teacher']), closeAssignment);
app.post('/api/assignments/:id/reopen', authenticateToken, requireRole(['teacher']), reopenAssignment);

// ================= LOG ROUTES (全链路操作留痕) =================
app.get('/api/logs', authenticateToken, requireRole(['teacher']), listLogs);

// ================= 生产环境：托管前端静态资源 =================
// 单机 Docker 部署时，后端 Express 直接托管构建产物 dist/，前后端同域同源，无需额外 nginx
const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // 单页应用兜底：非 /api 的 GET 请求统一返回 index.html（前端用状态路由，无独立子路径）
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// 初始化数据库并启动服务器
const startServer = async () => {
  try {
    await db.init();
    console.log('📚 [数据库] 本地 JSON 数据库初始化成功！');
    
    app.listen(PORT, () => {
      console.log(`🚀 [服务端] 可爱考试系统后端服务运行在: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ 服务端启动失败：', error);
    process.exit(1);
  }
};

startServer();
