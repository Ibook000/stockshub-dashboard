import { movingAverages } from './domain.js';
import { h, fmt, unit } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attrs = {}, content) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (content !== undefined) el.textContent = content;
  return el;
}
export function createChart(container, history, initial = 120, reference = null) {
  let range = initial,
    cleanup = () => {};
  const controls = h('div', { class: 'chart-controls', 'aria-label': '图表时间范围' });
  const plot = h('div', { class: 'chart-plot' });
  const readout = h('div', { class: 'chart-readout', 'aria-live': 'polite' });
  const legend = h(
    'div',
    { class: 'chart-legend' },
    h('span', {}, '日线 · 未复权'),
    h('span', { class: 'ma20' }, '— MA20'),
    h('span', { class: 'ma60' }, '— MA60'),
    h('span', {}, '下方为成交量'),
  );
  const averages = { 20: movingAverages(history.data, 20), 60: movingAverages(history.data, 60) };
  if (reference?.price > 0) legend.append(h('span', {}, `┄ 研究基准 ${fmt(reference.price)}`));
  for (const n of [60, 120, 250])
    controls.append(
      h(
        'button',
        {
          type: 'button',
          class: 'range-button',
          'aria-pressed': n === range,
          onClick: () => {
            range = n;
            draw();
          },
        },
        `${n} 日`,
      ),
    );
  container.replaceChildren(h('div', { class: 'chart-toolbar' }, legend, controls), readout, plot);
  function draw() {
    cleanup();
    controls
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-pressed', [60, 120, 250][i] === range));
    const bars = history.data.slice(-range);
    if (!bars.length) return;
    const offset = history.data.length - bars.length;
    const width = Math.max(260, plot.clientWidth),
      height = width < 500 ? 285 : 330;
    const left = 8,
      right = 58,
      top = 18,
      bottom = height - 79;
    const plotWidth = width - left - right,
      step = plotWidth / bars.length;
    const candleWidth = Math.min(9, Math.max(1, step * 0.62));
    let min = Math.min(...bars.map((b) => b.low)),
      max = Math.max(...bars.map((b) => b.high));
    if (reference?.price > 0) {
      min = Math.min(min, reference.price);
      max = Math.max(max, reference.price);
    }
    const pad = Math.max((max - min) * 0.1, max * 0.005);
    min -= pad;
    max += pad;
    const y = (value) => top + ((max - value) / (max - min)) * (bottom - top);
    const x = (i) => left + step * (i + 0.5);
    const svg = svgElement('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      tabindex: '0',
      role: 'img',
      'aria-label': `${bars[0].date} 至 ${bars.at(-1).date} 的未复权日线图。使用左右方向键查看每日价格。`,
    });
    for (let i = 0; i < 5; i++) {
      const value = min + ((max - min) * i) / 4;
      svg.append(
        svgElement('line', {
          x1: left,
          x2: width - right,
          y1: y(value),
          y2: y(value),
          class: 'chart-grid',
        }),
        svgElement(
          'text',
          { x: width - right + 8, y: y(value) + 4, class: 'chart-axis' },
          fmt(value),
        ),
      );
    }
    const maxVolume = Math.max(...bars.map((b) => b.volume), 1);
    bars.forEach((bar, i) => {
      const color = bar.close >= bar.open ? 'var(--up)' : 'var(--down)';
      svg.append(
        svgElement('line', {
          x1: x(i),
          x2: x(i),
          y1: y(bar.high),
          y2: y(bar.low),
          stroke: color,
          'stroke-width': '1',
        }),
        svgElement('rect', {
          x: x(i) - candleWidth / 2,
          y: Math.min(y(bar.open), y(bar.close)),
          width: candleWidth,
          height: Math.max(1, Math.abs(y(bar.open) - y(bar.close))),
          fill: color,
        }),
        svgElement('rect', {
          x: x(i) - candleWidth / 2,
          y: height - 29 - (bar.volume / maxVolume) * 36,
          width: candleWidth,
          height: Math.max(1, (bar.volume / maxVolume) * 36),
          fill: color,
          opacity: '.3',
        }),
      );
    });
    for (const n of [20, 60]) {
      let path = '',
        previous = false;
      bars.forEach((_, i) => {
        const value = averages[n][offset + i];
        if (value === null) {
          previous = false;
          return;
        }
        path += `${previous ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)} `;
        previous = true;
      });
      // Clip moving averages that temporarily lie outside the visible price range.
      const clipId = `clip-${crypto.randomUUID()}`;
      const defs = svgElement('defs'),
        clip = svgElement('clipPath', { id: clipId });
      clip.append(svgElement('rect', { x: left, y: top, width: plotWidth, height: bottom - top }));
      defs.append(clip);
      svg.append(defs);
      svg.append(
        svgElement('path', {
          d: path,
          fill: 'none',
          stroke: n === 20 ? 'var(--ma20)' : 'var(--ma60)',
          'stroke-width': '1.4',
          'clip-path': `url(#${clipId})`,
        }),
      );
    }
    for (const i of [0, Math.floor(bars.length / 2), bars.length - 1])
      svg.append(
        svgElement(
          'text',
          {
            x: x(i),
            y: height - 8,
            'text-anchor': i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle',
            class: 'chart-axis',
          },
          bars[i].date.slice(2),
        ),
      );
    if (reference?.price > 0)
      svg.append(
        svgElement('line', {
          x1: left,
          x2: width - right,
          y1: y(reference.price),
          y2: y(reference.price),
          stroke: 'var(--accent)',
          'stroke-dasharray': '5 4',
          'stroke-width': '1',
          'data-reference': 'price',
        }),
      );
    const noteIndex = reference?.date ? bars.findIndex((bar) => bar.date >= reference.date) : -1;
    if (noteIndex >= 0 && reference.date >= bars[0].date) {
      svg.append(
        svgElement('line', {
          x1: x(noteIndex),
          x2: x(noteIndex),
          y1: top,
          y2: bottom,
          stroke: 'var(--accent)',
          'stroke-dasharray': '2 4',
          'data-reference': 'created',
        }),
        svgElement(
          'text',
          {
            x: Math.min(width - right - 80, Math.max(left, x(noteIndex) + 5)),
            y: top + 12,
            class: 'chart-axis',
          },
          '研究创建',
        ),
      );
    }
    const crosshair = svgElement('line', { y1: top, y2: height - 29, class: 'chart-crosshair' });
    svg.append(crosshair);
    let selected = bars.length - 1;
    function select(index) {
      selected = Math.max(0, Math.min(bars.length - 1, index));
      const b = bars[selected];
      crosshair.setAttribute('x1', x(selected));
      crosshair.setAttribute('x2', x(selected));
      readout.replaceChildren(
        h('strong', {}, b.date),
        h('span', {}, `开 ${fmt(b.open)}`),
        h('span', {}, `高 ${fmt(b.high)}`),
        h('span', {}, `低 ${fmt(b.low)}`),
        h('span', {}, `收 ${fmt(b.close)}`),
        h('span', {}, `量 ${unit(b.volume)} 股`),
      );
    }
    const pointer = (event) =>
      select(Math.floor((event.clientX - svg.getBoundingClientRect().left - left) / step));
    const keyboard = (event) => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        select(selected + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    };
    svg.addEventListener('pointermove', pointer);
    svg.addEventListener('keydown', keyboard);
    cleanup = () => {
      svg.removeEventListener('pointermove', pointer);
      svg.removeEventListener('keydown', keyboard);
    };
    plot.replaceChildren(svg);
    select(selected);
  }
  const observer = new ResizeObserver(draw);
  observer.observe(plot);
  draw();
  return () => {
    observer.disconnect();
    cleanup();
  };
}
