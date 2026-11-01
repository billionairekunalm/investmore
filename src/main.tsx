import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { boot } from './store/store';

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js');
boot().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>));
