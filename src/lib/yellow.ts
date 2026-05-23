import { ADULT_SOURCE_KEYS } from '@/lib/config';
import { SearchResult } from '@/lib/types';

export const yellowWords = [
  '伦理片',
  '福利',
  '里番动漫',
  '门事件',
  '萝莉少女',
  '制服诱惑',
  '国产传媒',
  'cosplay',
  '黑丝诱惑',
  '无码',
  '日本无码',
  '有码',
  '日本有码',
  'SWAG',
  '网红主播',
  '色情片',
  '同性片',
  '福利视频',
  '福利片',
  '写真热舞',
  '成人',
  '情色',
  '三级片',
  '三級片',
  '18禁',
  'H片',
  '女优',
  '女優',
  '番号',
  '素人',
  '人妻',
  '巨乳',
];

export function isYellowSearchResult(result: SearchResult): boolean {
  if (ADULT_SOURCE_KEYS.has(result.source)) {
    return true;
  }

  const fields = [
    result.type_name,
    result.class,
    result.title,
    result.desc,
    result.source_name,
  ].filter((field): field is string => Boolean(field));

  return yellowWords.some((word) =>
    fields.some((field) =>
      field.toLocaleLowerCase().includes(word.toLocaleLowerCase())
    )
  );
}
