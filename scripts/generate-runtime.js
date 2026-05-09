#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require('fs');
const path = require('path');

// 讀取 config.json 文件路徑
const configPath = path.join(process.cwd(), 'config.json');
const outputPath = path.join(process.cwd(), 'src/lib/runtime.ts');

try {
  /** @type {Record<string, any>} */
  let config = {};

  if (fs.existsSync(configPath)) {
    // 有 config.json 就讀取
    const configContent = fs.readFileSync(configPath, 'utf-8');
    try {
      config = JSON.parse(configContent);
    } catch (err) {
      console.error('解析 config.json 失敗');
    }
  } else {
    console.warn('⚠️ 未找到 config.json 文件');
  }

  // 生成 TypeScript 代碼
  const tsContent = `// 該文件由 scripts/generate-runtime.js 自動生成，請勿手動修改
/* eslint-disable */

export default ${JSON.stringify(config, null, 2)};
`;

  // 確保目錄存在
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 寫入文件
  fs.writeFileSync(outputPath, tsContent, 'utf-8');
  console.log('✅ runtime.ts 文件生成成功');
} catch (error) {
  console.error('❌ 生成 runtime.ts 文件失敗:', error.message);
  process.exit(1);
}
