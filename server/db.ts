import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

// ============ 数据契约（向后兼容现有控制器）============
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'teacher' | 'student' | 'parent';
  name: string;
  childId?: string; // 【已废弃】仅用于兼容旧数据（单孩），新逻辑请用 childIds
  childIds?: string[]; // 仅限家长，绑定孩子的 studentId 列表（支持二孩/多孩）
  bindCode?: string; // 仅限学生，供家长绑定校验（由系统生成、教师下发）
  themePref?: string; // 用户偏好的显示主题（不影响作业内容）
  // 功能权益开关：用于控制「云端同步草稿」等可能收费的能力。缺省视为已开通。
  entitlements?: { cloud_sync?: boolean };
  mustChangePassword?: boolean; // 学生首次登录后强制改密（初始密码由老师下发）
}

export interface Class {
  id: string;
  name: string;
  teacherId: string;
  studentIds: string[];
}

export interface Exam {
  id: string;
  title: string;
  teacherId: string;
  classId: string;
  createdAt: number;
  totalPages: number;
  pages: string[]; // 每页试卷的图片 URL 或 Base64
  // —— 完整版：时限策略 / 主题 / 来源 ——
  timePolicy?: TimePolicy;
  theme?: { segment?: Segment; subject?: string };
  paperId?: string; // 来自试卷库预存卷
  assignmentId?: string; // 关联的发布作业聚合记录
  closed?: boolean; // 教师关闭后学生无法作答
}

export interface Submission {
  id: string;
  examId: string;
  studentId: string;
  status: 'draft' | 'submitted' | 'graded';
  submittedAt: number;
  gradedAt?: number;
  score?: number;
  comment?: string;
  answers: { pageIndex: number; canvasData: string }[]; // 学生每页透明涂鸦画板的 Base64 PNG
  teacherAnnotations?: { pageIndex: number; canvasData: string }[]; // 教师每页红笔批改的 Base64 PNG
  // —— 留痕扩展字段 ——
  firstEnteredAt?: number;
  durationMs?: number;
  // —— 草稿箱：云端进度保存 ——
  lastSavedAt?: number; // 最近一次自动存盘时间戳
  draftPages?: number; // 草稿已完成到第几页（1-based），用于草稿箱展示进度
  isLate?: boolean;
  lateMs?: number;
  device?: string;
  ip?: string;
  // —— 并发安全：每次保存自增，用于多设备提交冲突检测 ——
  version?: number;
  // —— 订正模式：graded 后学生重做，标记源自哪份已批改答卷 ——
  redoOf?: string;
  latePenaltyApplied?: number; // 批改时已扣除的迟交扣分
  // —— 完整版：多维能力评分 + 防伪分享码 ——
  dimensionScores?: { key: string; label: string; score: number; full: number }[];
  shareCode?: string;
}

// ============ 完整版新增契约 ============
export type Segment = 'you' | 'xiao' | 'zhong';

export interface Paper {
  id: string;
  title: string;
  ownerId: string;
  segment: Segment;
  subject?: string;
  tags?: string[];
  pages: string[]; // 预存试卷每页 Base64/URL
  status: 'draft' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface TimePolicy {
  mode: 'strict' | 'grace'; // strict=到点锁死禁止提交；grace=允许迟交并标记
  deadline?: number; // 截止时间戳（ms）
  durationMin?: number; // 倒计时作答时长（分钟），到点自动收卷
  latePenalty?: number; // 迟交扣分（0=仅标记不扣分）
  dailyWindow?: { start: string; end: string }; // 每日可作答时段 "HH:MM"；不设为当天随时可做
}

// 分页批量发布：把多页试卷按页分堆，每堆生成一份独立作业并自动排期
export interface SplitConfig {
  mode: 'uniform' | 'custom'; // uniform=每N页一份；custom=按指定序列分堆
  size?: number; // uniform 模式：每堆页数
  sizes?: number[]; // custom 模式：每堆页数序列，如 [3,5,3]
  startDate?: number; // 第一份作业截止时间戳（ms）
  intervalDays?: number; // 相邻两份作业截止日间隔（天），默认 1（每日一份）
}

export interface Assignment {
  id: string;
  paperId: string;
  title: string;
  teacherId: string;
  classIds: string[];
  examIds: string[]; // 每班生成的一份 Exam 的 id
  description?: string;
  timePolicy: TimePolicy;
  theme?: { segment?: Segment; subject?: string };
  allowRedo?: boolean;
  maxRedo?: number;
  status: 'published' | 'closed';
  createdAt: number;
}

export interface OperationLog {
  id: string;
  userId: string;
  role?: string;
  action: string; // create_paper | publish | submit | grade | revise_grade | delete ...
  targetType?: string; // paper | assignment | submission | user
  targetId?: string;
  at: number;
  ip?: string;
  device?: string;
  detail?: string;
}

// ============ SQLite 驱动（保留 getCollection/saveCollection 接口）============
const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const MIGRATE_FLAG = path.join(DATA_DIR, '.migrated');

const COLLECTIONS = [
  'users',
  'classes',
  'exams',
  'submissions',
  'papers',
  'assignments',
  'operationLogs',
] as const;

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

class SqliteDatabase {
  private db: Database.Database | null = null;
  private initPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        this.db = new Database(DB_FILE);
        this.db.pragma('journal_mode = WAL');
        for (const name of COLLECTIONS) {
          this.db.exec(
            `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`
          );
        }
        await this.migrateFromJson();
      } catch (error) {
        console.error('数据库初始化失败：', error);
        this.initPromise = null; // 允许后续重试
        throw error;
      }
    })();
    return this.initPromise;
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('数据库未初始化');
    return this.db;
  }

  // 首次运行：把历史 JSON 文件库迁移进 SQLite（仅一次）
  private async migrateFromJson(): Promise<void> {
    const jsonPath = path.join(DATA_DIR, 'db.json');
    if (fs.existsSync(jsonPath) && !fs.existsSync(MIGRATE_FLAG)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        for (const name of COLLECTIONS) {
          const rows = raw[name];
          if (Array.isArray(rows) && rows.length) this.saveSync(name, rows);
        }
        fs.writeFileSync(MIGRATE_FLAG, new Date().toISOString());
        console.log('📦 [数据库] 已从 db.json 迁移历史数据到 SQLite');
      } catch (e) {
        console.warn('⚠️ [数据库] 历史数据迁移跳过：', (e as Error).message);
      }
    }
  }

  private saveSync(name: string, rows: any[]): void {
    const database = this.getDb();
    database
      .prepare(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
      .run();
    const insert = database.prepare(`INSERT OR REPLACE INTO ${name} (id, data) VALUES (?, ?)`);
    const del = database.prepare(`DELETE FROM ${name}`);
    const tx = database.transaction((items: any[]) => {
      del.run();
      for (const item of items) {
        const id = typeof item?.id === 'string' ? item.id : randomUUID();
        insert.run(id, JSON.stringify(item));
      }
    });
    tx(rows);
  }

  async getCollection(name: string): Promise<any[]> {
    if (!NAME_RE.test(name)) throw new Error('非法集合名: ' + name);
    await this.init();
    const rows = this.getDb().prepare(`SELECT data FROM ${name}`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveCollection(name: string, rows: any[]): Promise<void> {
    if (!NAME_RE.test(name)) throw new Error('非法集合名: ' + name);
    await this.init();
    const database = this.getDb();
    database
      .prepare(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
      .run();
    const insert = database.prepare(`INSERT OR REPLACE INTO ${name} (id, data) VALUES (?, ?)`);
    const del = database.prepare(`DELETE FROM ${name}`);
    const tx = database.transaction((items: any[]) => {
      del.run();
      for (const item of items) {
        const id = typeof item?.id === 'string' ? item.id : randomUUID();
        insert.run(id, JSON.stringify(item));
      }
    });
    this.writeQueue = this.writeQueue.then(() => {
      tx(rows);
    });
    await this.writeQueue;
  }

  // 单条插入（审计日志 / 新建实体，避免整表重写）
  async insertOne(name: string, item: any): Promise<void> {
    if (!NAME_RE.test(name)) throw new Error('非法集合名: ' + name);
    await this.init();
    const id = typeof item?.id === 'string' ? item.id : randomUUID();
    this.getDb()
      .prepare(`INSERT OR REPLACE INTO ${name} (id, data) VALUES (?, ?)`)
      .run(id, JSON.stringify(item));
  }

  async findUserById(id: string): Promise<User | undefined> {
    const users = (await this.getCollection('users')) as User[];
    return users.find((u) => u.id === id);
  }

  async findUserByUsername(username: string): Promise<User | undefined> {
    const users = (await this.getCollection('users')) as User[];
    return users.find((u) => u.username === username);
  }

  // 审计日志便捷写入
  async appendLog(log: Omit<OperationLog, 'id' | 'at'> & { at?: number }): Promise<void> {
    const full: OperationLog = { id: randomUUID(), at: log.at ?? Date.now(), ...log };
    await this.insertOne('operationLogs', full);
  }
}

export const db = new SqliteDatabase();

// 生成一个全局唯一的学号（stu + 4 位数字，确保不与现有用户冲突）
export function generateStudentUsername(users: { username?: string }[]): string {
  for (let i = 0; i < 30; i++) {
    const cand = 'stu' + Math.floor(1000 + Math.random() * 9000); // stu1000 ~ stu9999
    if (!users.some((u) => u.username === cand)) return cand;
  }
  return 'stu' + Date.now().toString().slice(-6);
}
