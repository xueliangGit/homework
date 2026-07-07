import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// JWT 密钥：生产环境必须通过环境变量 JWT_SECRET 注入强随机串；此处仅为本地开发兜底，禁止用于生产。
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-fallback-change-me';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: 'teacher' | 'student' | 'parent';
    name: string;
  };
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '未登录或未提供身份验证 Token' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: '身份验证已失效，请重新登录' });
    }
    
    (req as AuthRequest).user = decoded as AuthRequest['user'];
    next();
  });
};

export const requireRole = (roles: Array<'teacher' | 'student' | 'parent'>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ message: '未登录或未提供身份验证 Token' });
    }

    if (!roles.includes(authReq.user.role)) {
      return res.status(403).json({ message: '您没有权限执行此操作' });
    }

    next();
  };
};
