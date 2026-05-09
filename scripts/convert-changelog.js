#!/usr/bin / env node

/* eslint-disable */

const fs = require('fs');
const path = require('path');

function parseChangelog(content) {
  const lines = content.split('\n');
  const versions = [];
  let currentVersion = null;
  let currentSection = null;
  let inVersionContent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 匹配版本行: ## [X.Y.Z] - YYYY-MM-DD
    const versionMatch = trimmedLine.match(
      /^## \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})$/
    );
    if (versionMatch) {
      if (currentVersion) {
        versions.push(currentVersion);
      }

      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        fixed: [],
        content: [], // 用於存儲原始內容，當沒有分類時使用
      };
      currentSection = null;
      inVersionContent = true;
      continue;
    }

    // 如果遇到下一個版本或到達文件末尾，停止處理當前版本
    if (inVersionContent && currentVersion) {
      // 匹配章節標題
      if (trimmedLine === '### Added') {
        currentSection = 'added';
        continue;
      } else if (trimmedLine === '### Changed') {
        currentSection = 'changed';
        continue;
      } else if (trimmedLine === '### Fixed') {
        currentSection = 'fixed';
        continue;
      }

      // 匹配條目: - 內容
      if (trimmedLine.startsWith('- ') && currentSection) {
        const entry = trimmedLine.substring(2);
        currentVersion[currentSection].push(entry);
      } else if (
        trimmedLine &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('###')
      ) {
        currentVersion.content.push(trimmedLine);
      }
    }
  }

  // 添加最後一個版本
  if (currentVersion) {
    versions.push(currentVersion);
  }

  // 後處理：如果某個版本沒有分類內容，但有 content，則將 content 放到 changed 中
  versions.forEach((version) => {
    const hasCategories =
      version.added.length > 0 ||
      version.changed.length > 0 ||
      version.fixed.length > 0;
    if (!hasCategories && version.content.length > 0) {
      version.changed = version.content;
    }
    // 清理 content 字段
    delete version.content;
  });

  return { versions };
}

function generateTypeScript(changelogData) {
  const entries = changelogData.versions
    .map((version) => {
      const addedEntries = version.added
        .map((entry) => `    "${entry}"`)
        .join(',\n');
      const changedEntries = version.changed
        .map((entry) => `    "${entry}"`)
        .join(',\n');
      const fixedEntries = version.fixed
        .map((entry) => `    "${entry}"`)
        .join(',\n');

      return `  {
    version: "${version.version}",
    date: "${version.date}",
    added: [
${addedEntries || '      // 無新增內容'}
    ],
    changed: [
${changedEntries || '      // 無變更內容'}
    ],
    fixed: [
${fixedEntries || '      // 無修復內容'}
    ]
  }`;
    })
    .join(',\n');

  return `// 此文件由 scripts/convert-changelog.js 自動生成
// 請勿手動編輯

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export const changelog: ChangelogEntry[] = [
${entries}
];

export default changelog;
`;
}

function updateVersionFile(version) {
  const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
  try {
    fs.writeFileSync(versionTxtPath, version, 'utf8');
    console.log(`✅ 已更新 VERSION.txt: ${version}`);
  } catch (error) {
    console.error(`❌ 無法更新 VERSION.txt:`, error.message);
    process.exit(1);
  }
}

function updateVersionTs(version) {
  const versionTsPath = path.join(process.cwd(), 'src/lib/version.ts');
  try {
    let content = fs.readFileSync(versionTsPath, 'utf8');

    // 替換 CURRENT_VERSION 常量
    const updatedContent = content.replace(
      /const CURRENT_VERSION = ['"`][^'"`]+['"`];/,
      `const CURRENT_VERSION = '${version}';`
    );

    fs.writeFileSync(versionTsPath, updatedContent, 'utf8');
    console.log(`✅ 已更新 version.ts: ${version}`);
  } catch (error) {
    console.error(`❌ 無法更新 version.ts:`, error.message);
    process.exit(1);
  }
}

function main() {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const outputPath = path.join(process.cwd(), 'src/lib/changelog.ts');

    console.log('正在讀取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

    console.log('正在解析 CHANGELOG 內容...');
    const changelogData = parseChangelog(changelogContent);

    if (changelogData.versions.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    // 獲取最新版本號（CHANGELOG中的第一個版本）
    const latestVersion = changelogData.versions[0].version;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 TypeScript 文件...');
    const tsContent = generateTypeScript(changelogData);

    // 確保輸出目錄存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, tsContent, 'utf-8');

    // 檢查是否在 GitHub Actions 環境中運行
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    if (isGitHubActions) {
      // 在 GitHub Actions 中，更新版本文件
      console.log('正在更新版本文件...');
      updateVersionFile(latestVersion);
      updateVersionTs(latestVersion);
    } else {
      // 在本地運行時，只提示但不更新版本文件
      console.log('🔧 本地運行模式：跳過版本文件更新');
      console.log('💡 版本文件更新將在 git tag 觸發的 release 工作流中完成');
    }

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log(`📊 版本統計:`);
    changelogData.versions.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length}`
      );
    });

    console.log('\n🎉 轉換完成!');
  } catch (error) {
    console.error('❌ 轉換失敗:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
