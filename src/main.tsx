import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeContext.tsx'

// 首屏前应用已保存的主题，避免闪烁
const savedTheme = localStorage.getItem('kk-theme') || 'xiao';
const savedSubject = localStorage.getItem('kk-subject') || 'general';
document.documentElement.dataset.theme = savedTheme;
document.documentElement.dataset.subject = savedSubject;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
