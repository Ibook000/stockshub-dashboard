import { freshness } from './domain.js';

export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function')
      element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') element.className = value;
    else if (key === 'value') element.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') element[key] = !!value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false)
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
const paths = {
  watch: 'M3 17l5-5 4 3 8-10M15 5h5v5',
  book: 'M4 3h12a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3zm0 15a3 3 0 0 1 3-3h12M8 7h7M8 10h5',
  check: 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M8 12l4 4L21 3',
  database:
    'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3zm0 0v12c0 2-4 3-8 3s-8-1-8-3V6m0 6c0 2 4 3 8 3s8-1 8-3',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zm5.5-2 5 5',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  close: 'M6 6l12 12M18 6 6 18',
  calendar: 'M5 5h14v16H5zm3-3v6m8-6v6M5 10h14',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    width: '20',
    height: '20',
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] ?? paths.arrow);
  svg.append(path);
  return svg;
}
export function button(label, action, className = 'secondary', symbol) {
  return h(
    'button',
    { type: 'button', class: `button ${className}`, onClick: action },
    symbol ? icon(symbol) : null,
    label,
  );
}
export function link(label, href, className = 'secondary', symbol) {
  return h('a', { class: `button ${className}`, href }, symbol ? icon(symbol) : null, label);
}
export function heading(title, subtitle, actions = []) {
  return h(
    'div',
    { class: 'page-heading' },
    h(
      'div',
      {},
      h('div', { class: 'eyebrow' }, 'RESEARCH WORKSPACE'),
      h('h1', {}, title),
      h('p', {}, subtitle),
    ),
    h('div', { class: 'actions' }, actions),
  );
}
export function empty(title, description, action) {
  return h(
    'div',
    { class: 'empty-state' },
    h('span', { class: 'empty-icon' }, icon('book')),
    h('h3', {}, title),
    h('p', {}, description),
    action,
  );
}
export function errorState(error, retry) {
  return h(
    'div',
    { class: 'error-state', role: 'alert' },
    h('strong', {}, '这部分暂时无法读取'),
    h('p', {}, error.message || String(error)),
    retry ? button('重新读取', retry, 'secondary', 'refresh') : null,
  );
}
export function loading(text = '正在读取数据…') {
  return h(
    'div',
    { class: 'loading-state', role: 'status' },
    h('span', { class: 'spinner' }),
    text,
  );
}
export function fmt(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';
}
export function pct(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
    : '—';
}
export function tone(value) {
  return value > 0 ? 'up' : value < 0 ? 'down' : '';
}
export function unit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1e8
    ? `${fmt(value / 1e8)} 亿`
    : Math.abs(value) >= 1e4
      ? `${fmt(value / 1e4)} 万`
      : fmt(value, 0);
}
export function dateTime(value, short = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    ...(short ? {} : { year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
  }).format(new Date(value));
}
export function sourceLine(data) {
  if (!data) return h('p', { class: 'source-line' }, '暂时没有数据，研究记录仍可保存。');
  const state = freshness(data);
  return h(
    'div',
    { class: 'source-line' },
    h('span', { class: `badge ${state.state === 'warning' ? 'warning' : ''}` }, state.label),
    h(
      'span',
      {},
      `${data.source} · 数据截至 ${data.time_precision === 'date' ? data.as_of.slice(0, 10) : dateTime(data.as_of)}${data.time_precision === 'intraday' ? '（当日日线未收盘）' : ''}`,
    ),
    data.warning ? h('span', { class: 'warning-text' }, data.warning) : null,
  );
}
let toastTimer;
export function toast(message, action) {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer);
  element.replaceChildren(
    h('span', {}, message),
    action
      ? button(
          action.label,
          () => {
            element.hidden = true;
            action.run();
          },
          'toast-action',
        )
      : null,
  );
  element.hidden = false;
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    action ? 10000 : 5000,
  );
}
export async function busy(button, work, label = '正在保存…') {
  if (button.disabled) return;
  const old = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(label);
  try {
    return await work();
  } catch (error) {
    toast(error.message || '操作失败，请重试。');
    throw error;
  } finally {
    button.disabled = false;
    button.replaceChildren(...old);
  }
}
export function field(label, control, hint) {
  const id = control.id || `field-${crypto.randomUUID()}`;
  control.id = id;
  if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('small', { id: `${id}-hint` }, hint) : null,
  );
}
