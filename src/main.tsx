import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Cesium configuration — MUST happen before any Cesium component renders
import { Ion } from 'cesium';

// Completely disable Cesium Ion to prevent ALL external requests
Ion.defaultAccessToken = 'offline-mode';
// @ts-ignore — Override Ion default server to prevent any requests
Ion.defaultServer = 'https://localhost:0/';

// Set Cesium asset path for workers/widgets
window.CESIUM_BASE_URL = './cesium';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
