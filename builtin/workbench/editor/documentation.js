import { marked } from 'marked';
import DOMPurify from 'dompurify';

const DOCUMENT_TAGS = ['p', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'del', 'sup', 'sub'];

function node(tag, text, className) {
  const element = document.createElement(tag); element.textContent = text;
  if (className) element.className = className;
  return element;
}

function markdown(text, className) {
  const content = node('div', '', className);
  // 源码注释不是可信 HTML，只保留文档排版，禁止图片等自动外部请求。
  content.append(DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
    ALLOWED_TAGS: DOCUMENT_TAGS, ALLOWED_ATTR: ['href', 'title', 'start'], RETURN_DOM_FRAGMENT: true,
  }));
  for (const link of content.querySelectorAll('a[href]')) {
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  return content;
}

export function documentationContent(docs, t) {
  const content = document.createDocumentFragment();
  if (docs.description) content.append(markdown(docs.description, 'documentation-description'));
  if (docs.params.length) {
    content.append(node('h3', t('params')));
    const list = document.createElement('dl');
    for (const param of docs.params) {
      const term = document.createElement('dt');
      term.append(node('code', param.name));
      if (param.type) term.append(node('span', param.type, 'documentation-type'));
      const detail = document.createElement('dd'); detail.append(markdown(param.description));
      list.append(term, detail);
    }
    content.append(list);
  }
  if (docs.returns) {
    content.append(node('h3', t('returns')));
    const value = node('div', '', 'documentation-return');
    if (docs.returns.type) value.append(node('code', docs.returns.type));
    value.append(markdown(docs.returns.description)); content.append(value);
  }
  if (docs.extra.length) content.append(node('pre', docs.extra.join('\n'), 'documentation-extra'));
  return content;
}
