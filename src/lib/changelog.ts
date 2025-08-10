// 此文件由 scripts/convert-changelog.js 自动生成
// 请勿手动编辑

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2025-08-10',
    added: [
      '基于 Semantic Versioning 的版本号机制',
      '版本信息面板，展示本地变更日志和远程更新日志',
    ],
    changed: [
      // 无变更内容
    ],
    fixed: [
      // 无修复内容
    ],
  },
];

export default changelog;
