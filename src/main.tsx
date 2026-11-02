import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { boot } from './store/store';

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js');
// Android/desktop Chrome offer "install app" once; keep the offer so the student portal can show an Install button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); (window as unknown as { installPrompt?: Event }).installPrompt = e; window.dispatchEvent(new Event('installready')); });
boot().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>));
