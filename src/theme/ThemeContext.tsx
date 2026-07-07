import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Segment = 'you' | 'xiao' | 'zhong';
export type Subject = 'general' | 'chinese' | 'math' | 'english' | 'science';

interface ThemeContextValue {
  theme: Segment;
  subject: Subject;
  setTheme: (t: Segment) => void;
  setSubject: (s: Subject) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = 'kk-theme';
const SUBJECT_KEY = 'kk-subject';

function apply(theme: Segment, subject: Subject) {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.subject = subject;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Segment>(
    () => (localStorage.getItem(THEME_KEY) as Segment) || 'xiao'
  );
  const [subject, setSubjectState] = useState<Subject>(
    () => (localStorage.getItem(SUBJECT_KEY) as Subject) || 'general'
  );

  useEffect(() => {
    apply(theme, subject);
  }, [theme, subject]);

  const setTheme = (t: Segment) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  };
  const setSubject = (s: Subject) => {
    setSubjectState(s);
    localStorage.setItem(SUBJECT_KEY, s);
  };

  return (
    <ThemeContext.Provider value={{ theme, subject, setTheme, setSubject }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return ctx;
}

export const SEGMENT_LABELS: Record<Segment, string> = {
  you: '幼教版',
  xiao: '小学版',
  zhong: '中学版',
};

export const SUBJECT_LABELS: Record<Subject, string> = {
  general: '通用',
  chinese: '语文',
  math: '数学',
  english: '英语',
  science: '科学',
};
