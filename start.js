#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');

// 調用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 直接在當前進程中啟動 standalone Server（`server.js`）
require('./server.js');

// 每 1 秒輪詢一次，直到請求成功
const TARGET_URL = `http://${process.env.HOSTNAME || 'localhost'}:${
  process.env.PORT || 3000
}/login`;

const intervalId = setInterval(() => {
  console.log(`Fetching ${TARGET_URL} ...`);

  const req = http.get(TARGET_URL, (res) => {
    // 當返回 2xx 狀態碼時認為成功，然後停止輪詢
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('Server is up, stop polling.');
      clearInterval(intervalId);

      // 服務器啟動後，立即執行一次 cron 任務
      executeCronJob();

      // 然後設置每小時執行一次 cron 任務
      setInterval(() => {
        executeCronJob();
      }, 60 * 60 * 1000); // 每小時執行一次
    }
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });
}, 1000);

// 執行 cron 任務的函數
function executeCronJob() {
  const cronUrl = `http://${process.env.HOSTNAME || 'localhost'}:${
    process.env.PORT || 3000
  }/api/cron`;

  console.log(`Executing cron job: ${cronUrl}`);

  const req = http.get(cronUrl, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
      } else {
        console.error('Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });
}
