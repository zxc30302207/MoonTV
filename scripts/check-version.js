#!/usr/bin / env node

/* eslint-disable */

const fs = require('fs');
const path = require('path');

/**
 * 版本检查脚本
 * 检查以下内容：
 * 1. src/lib/version.ts 中的 CURRENT_VERSION 是否与 VERSION.txt 一致
 * 2. CHANGELOG 中是否包含 VERSION.txt 中版本的日志
 */

function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    console.error(`❌ 无法读取文件 ${filePath}:`, error.message);
    process.exit(1);
  }
}

function extractVersionFromTsFile(content) {
  const match = content.match(/const CURRENT_VERSION = ['"`]([^'"`]+)['"`]/);
  if (!match) {
    console.error('❌ 无法从 version.ts 中提取 CURRENT_VERSION');
    process.exit(1);
  }
  return match[1];
}

function checkVersionInChangelog(changelogContent, version) {
  // 检查 CHANGELOG 中是否包含指定版本的日志
  const versionPatterns = [
    new RegExp(`## \\[${version.replace(/\./g, '\\.')}\\]`, 'i'),
  ];

  return versionPatterns.some((pattern) => pattern.test(changelogContent));
}

function main() {
  console.log('🔍 开始版本检查...\n');

  // 获取项目根目录
  const projectRoot = path.resolve(__dirname, '..');

  // 读取相关文件
  const versionTxtPath = path.join(projectRoot, 'VERSION.txt');
  const versionTsPath = path.join(projectRoot, 'src/lib/version.ts');
  const changelogPath = path.join(projectRoot, 'CHANGELOG');

  console.log('📁 检查文件路径:');
  console.log(`   VERSION.txt: ${versionTxtPath}`);
  console.log(`   version.ts: ${versionTsPath}`);
  console.log(`   CHANGELOG: ${changelogPath}\n`);

  // 检查文件是否存在
  [versionTxtPath, versionTsPath, changelogPath].forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }
  });

  // 读取文件内容
  const versionTxtContent = readFileContent(versionTxtPath);
  const versionTsContent = readFileContent(versionTsPath);
  const changelogContent = readFileContent(changelogPath);

  console.log('📖 读取文件内容完成\n');

  // 提取版本号
  const versionFromTxt = versionTxtContent;
  const versionFromTs = extractVersionFromTsFile(versionTsContent);

  console.log('🔢 版本信息:');
  console.log(`   VERSION.txt: ${versionFromTxt}`);
  console.log(`   version.ts: ${versionFromTs}\n`);

  // 检查 1: 版本一致性
  console.log('✅ 检查 1: 版本一致性');
  if (versionFromTxt === versionFromTs) {
    console.log('   ✅ 版本一致');
  } else {
    console.error('   ❌ 版本不一致!');
    console.error(`      VERSION.txt: ${versionFromTxt}`);
    console.error(`      version.ts: ${versionFromTs}`);
    process.exit(1);
  }

  // 检查 2: 变更日志
  console.log('\n✅ 检查 2: 变更日志');
  if (checkVersionInChangelog(changelogContent, versionFromTxt)) {
    console.log('   ✅ 变更日志包含当前版本');
  } else {
    console.error('   ❌ 变更日志中未找到当前版本!');
    console.error(`      当前版本: ${versionFromTxt}`);
    console.error('      请检查 CHANGELOG 文件格式是否正确');
    process.exit(1);
  }

  console.log('\n🎉 所有检查通过! 版本信息一致且完整。');
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { main };
