export interface User {
  id: string;
  username: string;
  role: 'teacher' | 'student' | 'parent';
  name: string;
  childId?: string;
}

export interface Class {
  id: string;
  name: string;
  teacherId: string;
  studentIds: string[];
  students?: { id: string; username: string; name: string }[];
}

export interface Exam {
  id: string;
  title: string;
  teacherId: string;
  classId: string;
  createdAt: number;
  totalPages: number;
  pages: string[]; // 试卷每页的图片数据 (Base64)
}

export interface SubmissionAnswer {
  pageIndex: number;
  canvasData: string; // 学生答卷透明 Canvas Base64 PNG
}

export interface TeacherAnnotation {
  pageIndex: number;
  canvasData: string; // 教师批改透明 Canvas Base64 PNG
}

export interface Submission {
  id: string;
  examId: string;
  studentId: string;
  status: 'submitted' | 'graded';
  submittedAt: number;
  gradedAt?: number;
  score?: number;
  comment?: string;
  answers: SubmissionAnswer[];
  teacherAnnotations?: TeacherAnnotation[];
  dimensionScores?: { key: string; label: string; score: number; full: number }[];
  shareCode?: string;
}

// 时限策略
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

export type Segment = 'you' | 'xiao' | 'zhong';

// 学生视角下的试卷项目
export interface StudentExamItem {
  id: string;
  title: string;
  classId: string;
  className: string;
  createdAt: number;
  totalPages: number;
  status: 'unstarted' | 'submitted' | 'graded';
  score?: number;
  comment?: string;
  submissionId?: string;
  timePolicy?: TimePolicy | null;
  closed?: boolean;
  theme?: { segment?: Segment; subject?: string } | null;
  isLate?: boolean;
}

// 教师视角下的发布作业（管理列表）
export interface AssignmentItem {
  id: string;
  title: string;
  paperId: string;
  classIds: string[];
  classNames: string[];
  examIds: string[];
  examCount: number;
  submittedCount: number;
  timePolicy: TimePolicy;
  theme?: { segment?: Segment; subject?: string };
  status: 'published' | 'closed';
  createdAt: number;
}

// 全链路操作留痕
export interface LogItem {
  id: string;
  at: number;
  action: string;
  role?: string;
  userId?: string;
  targetType?: string;
  targetId?: string;
  detail?: any;
  ip?: string;
  device?: string;
}

// 家长视角下的报告项目
export interface ChildReportItem {
  submissionId: string;
  examId: string;
  studentId: string;
  childName: string;
  examTitle: string;
  status: 'submitted' | 'graded';
  submittedAt: number;
  gradedAt?: number;
  score?: number;
  comment?: string;
}
