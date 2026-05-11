import { isDoubanVerificationHtml } from './douban';

describe('douban fetch helpers', () => {
  it('detects Douban verification challenge pages', () => {
    const html = `
      <html>
        <body>
          <form action="https://sec.douban.com/b" method="post">
            <input type="hidden" name="tok" value="token" />
            <input type="hidden" name="cha" value="challenge" />
            <input type="hidden" name="red" value="https://movie.douban.com/" />
          </form>
        </body>
      </html>
    `;

    expect(isDoubanVerificationHtml(html)).toBe(true);
  });

  it('does not classify normal Douban comment pages as verification', () => {
    const html = `
      <html>
        <body>
          <div class="comment-item" data-cid="1001">
            <span class="short">好看，節奏很穩。</span>
          </div>
        </body>
      </html>
    `;

    expect(isDoubanVerificationHtml(html)).toBe(false);
  });
});
