#!/usr/bin / env node

/* eslint-disable */

const fs = require('fs');
const path = require('path');

function parseChangelog(content) {
  const lines = content.split('\n');
  const versions = [];
  let currentVersion = null;
  let currentSection = null;

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
      };
      currentSection = null;
      continue;
    }

    // 匹配章节标题
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

    // 匹配条目: - 内容
    if (trimmedLine.startsWith('- ') && currentSection && currentVersion) {
      const entry = trimmedLine.substring(2);
      currentVersion[currentSection].push(entry);
    }
  }

  // 添加最后一个版本
  if (currentVersion) {
    versions.push(currentVersion);
  }

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
${addedEntries || '      // 无新增内容'}
    ],
    changed: [
${changedEntries || '      // 无变更内容'}
    ],
    fixed: [
${fixedEntries || '      // 无修复内容'}
    ]
  }`;
    })
    .join(',\n');

  return `// 此文件由 scripts/convert-changelog.js 自动生成
// 请勿手动编辑

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
    console.error(`❌ 无法更新 VERSION.txt:`, error.message);
    process.exit(1);
  }
}

function updateVersionTs(version) {
  const versionTsPath = path.join(process.cwd(), 'src/lib/version.ts');
  try {
    let content = fs.readFileSync(versionTsPath, 'utf8');

    // 替换 CURRENT_VERSION 常量
    const updatedContent = content.replace(
      /const CURRENT_VERSION = ['"`][^'"`]+['"`];/,
      `const CURRENT_VERSION = '${version}';`
    );

    fs.writeFileSync(versionTsPath, updatedContent, 'utf8');
    console.log(`✅ 已更新 version.ts: ${version}`);
  } catch (error) {
    console.error(`❌ 无法更新 version.ts:`, error.message);
    process.exit(1);
  }
}

function main() {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const outputPath = path.join(process.cwd(), 'src/lib/changelog.ts');

    console.log('正在读取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

    console.log('正在解析 CHANGELOG 内容...');
    const changelogData = parseChangelog(changelogContent);

    if (changelogData.versions.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    // 获取最新版本号（CHANGELOG中的第一个版本）
    const latestVersion = changelogData.versions[0].version;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 TypeScript 文件...');
    const tsContent = generateTypeScript(changelogData);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, tsContent, 'utf-8');

    // 更新版本文件
    console.log('正在更新版本文件...');
    updateVersionFile(latestVersion);
    updateVersionTs(latestVersion);

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log(`📊 版本统计:`);
    changelogData.versions.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length}`
      );
    });

    console.log('\n🎉 所有更新完成!');
  } catch (error) {
    console.error('❌ 转换失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
