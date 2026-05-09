#!/usr/bin/env node
/* eslint-disable */
// 根據 NEXT_PUBLIC_SITE_NAME 動態生成 manifest.json

const fs = require('fs');
const path = require('path');

// 獲取項目根目錄
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');

// 從環境變量獲取站點名稱
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV';

// manifest.json 模板
const manifestTemplate = {
  name: siteName,
  short_name: siteName,
  description: '影視聚合',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#000000',
  'apple-mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-status-bar-style': 'black',
  icons: [
    {
      src: '/icons/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: '/icons/icon-256x256.png',
      sizes: '256x256',
      type: 'image/png',
    },
    {
      src: '/icons/icon-384x384.png',
      sizes: '384x384',
      type: 'image/png',
    },
    {
      src: '/icons/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
    },
  ],
};

try {
  // 確保 public 目錄存在
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // 寫入 manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifestTemplate, null, 2));
  console.log(`✅ Generated manifest.json with site name: ${siteName}`);
} catch (error) {
  console.error('❌ Error generating manifest.json:', error);
  process.exit(1);
}
