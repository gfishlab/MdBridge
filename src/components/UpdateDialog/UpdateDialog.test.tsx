import { describe, it, expect } from 'vitest';
import { extractChangelogItems } from './UpdateDialog';

describe('extractChangelogItems', () => {
  it('提取分割线之前的变更条目，剔除 Assets 下载说明', () => {
    const body = [
      '### 优化',
      '',
      '- 版本更新弹窗中的更新日志改用 Markdown 渲染，列表、加粗等格式可正常展示。',
      '',
      '---',
      '',
      '请在下方 Assets 中下载对应平台的安装包。',
      '',
      '- macOS：下载 `.dmg`',
      '- Windows：下载 `.exe` 或 `.msi`',
      '- Linux：下载 `.AppImage`、`.deb` 或 `.rpm`',
    ].join('\n');

    expect(extractChangelogItems(body)).toEqual([
      '版本更新弹窗中的更新日志改用 Markdown 渲染，列表、加粗等格式可正常展示。',
    ]);
  });

  it('支持多条变更，并兼容 * 列表标记', () => {
    const body = [
      '### 修复',
      '',
      '- 修复实时文件刷新的竞态问题。',
      '* 新增针对该竞态条件的回归测试。',
    ].join('\n');

    expect(extractChangelogItems(body)).toEqual([
      '修复实时文件刷新的竞态问题。',
      '新增针对该竞态条件的回归测试。',
    ]);
  });

  it('兼容有序列表标记（1. 2. 3.）', () => {
    const body = [
      '### 新增',
      '',
      '1. 支持自定义快捷键。',
      '2. 新增暗色主题。',
      '10. 优化大文件加载性能。',
    ].join('\n');

    expect(extractChangelogItems(body)).toEqual([
      '支持自定义快捷键。',
      '新增暗色主题。',
      '优化大文件加载性能。',
    ]);
  });

  it('没有分割线时返回全部列表条目', () => {
    const body = ['- 条目一', '- 条目二'].join('\n');
    expect(extractChangelogItems(body)).toEqual(['条目一', '条目二']);
  });

  it('正文为空时返回空数组', () => {
    expect(extractChangelogItems('')).toEqual([]);
  });
});
