import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

/** 挂载本机论文阅读界面。 */
createRoot(document.getElementById('root')!).render(<App />);
