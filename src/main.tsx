import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register PWA service worker with auto-update
registerSW({
  onNeedRefresh() {
    // New version downloaded; will activate on next reload.
    console.log('[DecoLog] New version available, reload to update.');
  },
  onOfflineReady() {
    // All core assets cached; cold-start offline should work.
    console.log('[DecoLog] Offline cache ready.');
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
