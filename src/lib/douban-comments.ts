import * as cheerio from 'cheerio';

export interface DoubanComment {
  id: string;
  userName: string;
  userAvatar: string;
  userUrl: string;
  rating: number | null;
  content: string;
  time: string;
  votes: number;
}

export interface DoubanCommentsResult {
  comments: DoubanComment[];
  total: number;
  start: number;
  limit: number;
  hasMore: boolean;
}

export function parseDoubanCommentsHtml(
  html: string,
  start: number,
  limit: number
): DoubanCommentsResult {
  const $ = cheerio.load(html);
  const comments: DoubanComment[] = [];

  $('.comment-item').each((_, element) => {
    const $comment = $(element);
    const id = ($comment.attr('data-cid') || '').trim();
    const userUrl = (
      $comment.find('.avatar a').attr('href') ||
      $comment.find('.comment-info a').first().attr('href') ||
      ''
    ).trim();
    const userAvatar = ($comment.find('.avatar img').attr('src') || '').trim();
    const userName = (
      $comment.find('.avatar a').attr('title') ||
      $comment.find('.comment-info a').first().text() ||
      ''
    ).trim();
    const content = $comment.find('.short').text().trim();
    const time = (
      $comment.find('.comment-time').attr('title') ||
      $comment.find('.comment-time').text() ||
      ''
    ).trim();
    const rating = parseRating($comment.find('.rating').attr('class') || '');
    const votes = parseInteger($comment.find('.votes.vote-count').text());

    if (!id || !content) return;

    comments.push({
      id,
      userName,
      userAvatar,
      userUrl,
      rating,
      content,
      time,
      votes,
    });
  });

  const total = resolveTotal($, start, limit, comments.length);

  return {
    comments,
    total,
    start,
    limit,
    hasMore:
      total > 0 ? start + comments.length < total : comments.length >= limit,
  };
}

function parseRating(className: string): number | null {
  const match = className.match(/allstar(\d)0/);
  if (!match) return null;
  return parseInteger(match[1]);
}

function parseInteger(value: string | undefined): number {
  const match = `${value || ''}`.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function resolveTotal(
  $: cheerio.CheerioAPI,
  start: number,
  limit: number,
  commentsCount: number
): number {
  const candidates = [
    $('.mod-hd h2, h2, .section-title, .tabs, .nav-tabs').text(),
    $('body').text(),
  ];

  for (const text of candidates) {
    const normalized = text.replace(/\s+/g, ' ');
    const match =
      normalized.match(/全部\s*(\d+)\s*条/) ||
      normalized.match(/短评\s*[（(]\s*(\d+)\s*[）)]/) ||
      normalized.match(/看过\s*[（(]\s*(\d+)\s*[）)]/);
    if (match) return Number.parseInt(match[1], 10);
  }

  if (commentsCount === 0) return 0;
  return start + commentsCount + (commentsCount >= limit ? 1 : 0);
}
