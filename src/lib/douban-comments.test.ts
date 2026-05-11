import { parseDoubanCommentsHtml } from './douban-comments';

describe('douban-comments', () => {
  it('parses comments, rating, time, votes, and pagination', () => {
    const html = `
      <html>
        <body>
          <div class="mod-hd"><h2>全部 123 条</h2></div>
          <div class="comment-item" data-cid="1001">
            <div class="avatar">
              <a href="https://www.douban.com/people/u1/" title="Alice">
                <img src="https://img.example.com/u1.jpg" />
              </a>
            </div>
            <span class="comment-info">
              <span class="allstar40 rating"></span>
              <span class="comment-time" title="2026-05-11 10:00:00"></span>
            </span>
            <span class="votes vote-count">18</span>
            <span class="short">好看，節奏很穩。</span>
          </div>
          <div class="comment-item" data-cid="1002">
            <span class="comment-info">
              <a href="https://www.douban.com/people/u2/">Bob</a>
              <span class="comment-time">2026-05-10</span>
            </span>
            <span class="votes vote-count">0</span>
            <span class="short">第二集比較強。</span>
          </div>
        </body>
      </html>
    `;

    const result = parseDoubanCommentsHtml(html, 20, 20);

    expect(result.total).toBe(123);
    expect(result.hasMore).toBe(true);
    expect(result.comments).toEqual([
      {
        id: '1001',
        userName: 'Alice',
        userAvatar: 'https://img.example.com/u1.jpg',
        userUrl: 'https://www.douban.com/people/u1/',
        rating: 4,
        content: '好看，節奏很穩。',
        time: '2026-05-11 10:00:00',
        votes: 18,
      },
      {
        id: '1002',
        userName: 'Bob',
        userAvatar: '',
        userUrl: 'https://www.douban.com/people/u2/',
        rating: null,
        content: '第二集比較強。',
        time: '2026-05-10',
        votes: 0,
      },
    ]);
  });

  it('estimates more pages when Douban hides the total', () => {
    const html = Array.from({ length: 2 })
      .map(
        (_, index) => `
          <div class="comment-item" data-cid="${index}">
            <span class="short">comment ${index}</span>
          </div>
        `
      )
      .join('');

    const result = parseDoubanCommentsHtml(html, 0, 2);

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });
});
