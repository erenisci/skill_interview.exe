import { describe, expect, it } from 'vitest';
import { htmlToText, isUsable, markdownToText, truncate } from './extract';

describe('htmlToText', () => {
  it('drops script, style and navigation rather than turning them into prose', () => {
    const html = `
      <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
      <script>window.analytics.track('view')</script>
      <style>.a{color:red}</style>
      <p>nginx is a reverse proxy.</p>
      <footer>© 2026</footer>`;
    const text = htmlToText(html);
    expect(text).toContain('nginx is a reverse proxy.');
    expect(text).not.toContain('analytics');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('Docs');
  });

  it('decodes the entities that would otherwise reach the prompt as noise', () => {
    expect(htmlToText('<p>a&nbsp;&amp;&nbsp;b &lt;tag&gt; &quot;q&quot;</p>')).toBe(
      'a & b <tag> "q"',
    );
  });

  it('strips comments, which can hide entire hidden blocks', () => {
    expect(htmlToText('<p>real</p><!-- <p>hidden</p> -->')).toBe('real');
  });

  it('collapses the whitespace that markup leaves behind', () => {
    // Newlines in HTML source are formatting, not content — the structure was in the tags.
    expect(htmlToText('<div>  a  </div>\n\n\n<div>b</div>')).toBe('a b');
  });
});

describe('markdownToText', () => {
  it('keeps link text but discards the URL', () => {
    expect(markdownToText('See [the docs](https://example.com/docs) for more.')).toBe(
      'See the docs for more.',
    );
  });

  it('drops images and badges, which READMEs are full of', () => {
    expect(markdownToText('![build](https://img.shields.io/x.svg)\nnginx is a proxy.')).toBe(
      'nginx is a proxy.',
    );
  });

  it('drops fenced code — it says little about what a tool is', () => {
    const md = 'Install it:\n```bash\nnpm i thing\n```\nIt proxies requests.';
    const text = markdownToText(md);
    expect(text).not.toContain('npm i thing');
    expect(text).toContain('It proxies requests.');
  });

  it('removes heading markers without removing the heading', () => {
    expect(markdownToText('## What is nginx?\nA proxy.')).toBe('What is nginx?\nA proxy.');
  });

  it('strips the HTML that READMEs embed', () => {
    expect(markdownToText('<p align="center">nginx</p>\n\nA proxy.')).toBe('nginx\n\nA proxy.');
  });
});

describe('isUsable', () => {
  it('rejects a login wall or JavaScript shell that extracted to almost nothing', () => {
    expect(isUsable('Please enable JavaScript.')).toBe(false);
    expect(isUsable('')).toBe(false);
  });

  it('accepts text long enough to ground a card', () => {
    expect(isUsable('x'.repeat(200))).toBe(true);
  });
});

describe('truncate', () => {
  it('leaves text within budget alone', () => {
    expect(truncate('short', 100)).toBe('short');
  });

  it('cuts on a word boundary rather than mid-word', () => {
    expect(truncate('alpha beta gamma delta', 14)).toBe('alpha beta');
  });

  it('still cuts when there is no usable boundary near the limit', () => {
    expect(truncate('a'.repeat(50), 10)).toHaveLength(10);
  });
});
