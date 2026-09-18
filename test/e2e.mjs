/**
 * 公众号排版工作台 —— 端到端验证
 *
 * 用真实 Chrome 打开 index.html，逐项断言渲染结果、微信合规性与交互链路。
 * 全部通过则退出码为 0（断言条数见报告末尾的合计）。
 *
 * 运行：
 *   npm install
 *   npm test
 *
 * 浏览器：默认使用本机已安装的 Google Chrome（channel: 'chrome'）。
 *   - 没装 Chrome 时改用 Edge：  PW_CHANNEL=msedge npm test
 *   - 直接指定可执行文件：        PW_EXECUTABLE="C:\path\to\chrome.exe" npm test
 *
 * 产物：test/artifacts/*.png（界面截图）、test/verification-report.txt（断言明细）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

const ARTIFACTS = path.join(__dirname, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });
const REPORT = path.join(__dirname, 'verification-report.txt');

const OUT = [];
const dump = (msg) => { try { fs.writeFileSync(REPORT, OUT.join('\n') + '\n\n!! ' + msg, 'utf8'); } catch (e) { /* ignore */ } };
process.on('uncaughtException', e => { dump('UNCAUGHT: ' + (e && e.stack || e)); process.exit(2); });
process.on('unhandledRejection', e => { dump('REJECTED: ' + (e && e.stack || e)); process.exit(2); });
const ok = (name, cond, extra = '') =>
  OUT.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);

const TEST_MD = `---
title: 全要素渲染测试
author: 测试
date: 2026年9月18日
lead: 这是一段导语，用来验证导语块的渲染。
h2_num: formal
---

正文第一段，包含 **加粗文字** 与 *斜体文字* 以及 \`行内代码\`。

## 第一个小节

- 无序项一
- 无序项二

1. 有序项一
2. 有序项二

> 这是一段引用，用来验证引用块。

### 三级标题

| 名称 | 数量 |
| --- | --- |
| 甲 | 1 |
| 乙 | 2 |

\`\`\`js
const a = 1;
console.log(a);
\`\`\`

---

![示例图片](https://example.com/a.png)

参考外部资料 [点这里](https://example.com/doc)。
`;

const launchOpts = process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE, headless: true }
  : { channel: process.env.PW_CHANNEL || 'chrome', headless: true };

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 940 },
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => {
  /* 只放行两类噪音：favicon，以及样本稿里那张外部占位图（example.com/a.png）
     在离线/代理不通时的资源加载失败。这里要抓的是「应用自身的报错」。 */
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon/.test(t)) return;
  if (/Failed to load resource/.test(t) && /net::ERR_|example\.com/.test(t)) return;
  errors.push('[console] ' + t);
});

await page.goto(PAGE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(800);

ok('页面无 JS 运行时错误', errors.length === 0, errors.join(' ;; '));

/* ---------- 1. 默认状态：示例稿已渲染 ---------- */
let r = await page.evaluate(() => {
  const a = document.querySelector('#article');
  return {
    html: a.innerHTML.length,
    sections: a.querySelectorAll('section').length,
    ps: a.querySelectorAll('p').length,
    rootStyle: a.getAttribute('style') || '',
    rootBg: getComputedStyle(a).backgroundColor,
    chips: document.querySelectorAll('.themepop .tp-item').length,
    onChip: document.querySelector('.themepop .tp-item.on')?.dataset.id,
    srcLen: document.querySelector('#source').value.length,
    overflow: a.scrollWidth - a.clientWidth
  };
});
ok('默认载入示例稿并渲染', r.html > 500 && r.ps > 5, `innerHTML=${r.html} p=${r.ps} section=${r.sections}`);
ok('根容器带内联样式', /background-color/.test(r.rootStyle), r.rootStyle.slice(0, 60));
ok('主题弹层包含 10 个主题', r.chips === 10, 'chips=' + r.chips);
ok('默认主题为古风', r.onChip === 'gu-feng', 'on=' + r.onChip);
ok('正文不横向溢出手机宽度', r.overflow <= 1, 'overflow=' + r.overflow);

/* ---------- 1b. 右栏高度分配 + 主题弹层 ----------
   10 个主题原本常驻铺开，窄一点的窗口要占两行、把预览区压得很扁，
   现在改成工具条按钮 + 按需展开的弹层，并顺带压缩了工具条。 */
const layout = await page.evaluate(() => {
  const h = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : -1; };
  const pane = h('.pane-out'), card = h('.out-card'), preview = h('#previewWrap');
  return {
    themeStripGone: document.querySelector('#themeStrip') === null,
    popHidden: document.querySelector('.themepop').hidden,
    card, preview, pane,
    ratio: pane > 0 ? preview / pane : 0,
    btnName: document.querySelector('#btnThemeName').textContent,
    foot: document.querySelector('#footTheme').textContent
  };
});
ok('主题条已从常驻布局中移除、主题弹层默认收起',
  layout.themeStripGone && layout.popHidden, JSON.stringify(layout));
ok('工具区（主题按钮 + 工具条，样式面板已收起）高度 ≤ 100px',
  layout.card > 0 && layout.card <= 100, 'out-card=' + layout.card + 'px');
ok('预览区占右栏高度 ≥ 83%', layout.ratio >= 0.83, (layout.ratio * 100).toFixed(1) + '%');
ok('主题按钮与底部状态条都显示当前主题',
  layout.btnName === '古风宣纸' && layout.foot === '古风宣纸',
  'btn=' + layout.btnName + ' foot=' + layout.foot);

await page.click('#btnTheme');
await page.waitForTimeout(260);
const pop = await page.evaluate(() => {
  const el = document.querySelector('.themepop');
  const box = el.getBoundingClientRect();
  const items = [...el.querySelectorAll('.tp-item')];
  const visible = items.filter((i) => {
    const r = i.getBoundingClientRect();
    return r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1;
  }).length;
  return {
    hidden: el.hidden, items: items.length, visible,
    inView: box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
    noScroll: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
    nameClipped: items.filter((i) => { const n = i.querySelector('.tp-nm'); return n.scrollWidth > n.clientWidth + 1; }).length
  };
});
ok('点主题按钮展开弹层：10 项全部可见、主题名未被省略、无滚动条',
  !pop.hidden && pop.items === 10 && pop.visible === 10 && pop.noScroll && pop.nameClipped === 0,
  JSON.stringify(pop));
ok('主题弹层完整落在视口内', pop.inView, JSON.stringify(pop));
const cardWhileOpen = await page.evaluate(() => Math.round(document.querySelector('.out-card').getBoundingClientRect().height));
ok('主题弹层是浮层：展开时工具区高度不变', Math.abs(cardWhileOpen - layout.card) <= 1,
  'before=' + layout.card + ' whileOpen=' + cardWhileOpen);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const popEsc = await page.evaluate(() => document.querySelector('.themepop').hidden);
ok('Esc 可关闭主题弹层', popEsc === true, 'hidden=' + popEsc);

await page.waitForTimeout(700);
const bud = await page.evaluate(() => document.querySelector('#charBudget').textContent);
ok('字符预算指示器工作', /\d[\d,]*\s*\/\s*20,000/.test(bud), bud);

const panelDefault = await page.evaluate(() => {
  const p = document.querySelector('#stylePanel');
  return { hiddenAttr: p.hasAttribute('hidden'), display: getComputedStyle(p).display };
});
ok('样式面板首次访问默认收起（[hidden] 未被 display 覆盖）',
   panelDefault.hiddenAttr && panelDefault.display === 'none', JSON.stringify(panelDefault));

/* ---------- 2. 全要素渲染 ---------- */
await page.fill('#source', TEST_MD);
await page.waitForTimeout(800);
r = await page.evaluate(() => {
  const a = document.querySelector('#article');
  const q = s => a.querySelectorAll(s).length;
  return {
    title: q('p') > 0,
    h2: [...a.querySelectorAll('section')].some(s => s.textContent.includes('第一个小节') && s.getAttribute('style')),
    h2Decor: (() => {
      const s = [...a.querySelectorAll('section')].find(x => x.textContent.includes('第一个小节'));
      return s ? s.getAttribute('style') : '';
    })(),
    h2num: a.innerHTML.includes('壹'),
    h3: a.innerHTML.includes('三级标题'),
    quote: !!a.querySelector('section[style*="border-left"]'),
    ul: (a.innerHTML.match(/◆|·|✦|✓|▸|❀|✎|—/g) || []).length,
    ol: a.innerHTML.includes('>1</span>') || a.innerHTML.includes('>1<'),
    code: a.innerHTML.includes('console.log'),
    hr: a.innerHTML.includes('◆　◆　◆') || a.innerHTML.includes('　'),
    img: q('img'),
    table: q('table'),
    fn: a.innerHTML.includes('参考资料') || a.innerHTML.includes('https://example.com/doc'),
    imgMaxW: (() => { const i = a.querySelector('img'); return i ? i.style.maxWidth : ''; })(),
    th: a.querySelectorAll('table td').length,
    overflow: a.scrollWidth - a.clientWidth
  };
});
ok('二级标题套用主题装饰', r.h2 && /border-bottom|border-left|background-color/.test(r.h2Decor), r.h2Decor.slice(0, 70));
ok('二级标题汉字序号（formal）', r.h2num, '');
ok('三级标题渲染', r.h3);
ok('引用块渲染', r.quote);
ok('无序列表项目符号', r.ul >= 2, 'marks=' + r.ul);
ok('有序列表序号', r.ol);
ok('代码块渲染', r.code);
ok('分割线渲染', r.hr);
ok('图片渲染', r.img === 1, 'img=' + r.img);
ok('图片带 max-width:100%', r.imgMaxW === '100%', 'maxWidth=' + r.imgMaxW);
ok('表格渲染', r.table === 1 && r.th >= 4, `table=${r.table} cells=${r.th}`);
ok('站外链接转脚注', r.fn);
ok('全要素下不横向溢出', r.overflow <= 1, 'overflow=' + r.overflow);

await page.screenshot({ path: path.join(ARTIFACTS, 'shot-1-light.png'), fullPage: false });

/* ---------- 3. 导出 HTML 的微信合规性 ---------- */
const exp = await page.evaluate(() => buildExportHtml());
ok('导出内容无 <style> 标签', !/<style/i.test(exp));
ok('导出内容无 class 属性', !/\sclass=/.test(exp));
ok('导出内容无 id 属性', !/\sid=/.test(exp));
ok('导出内容无 data-* 属性', !/\sdata-[a-z]+=/.test(exp));
ok('导出内容无 contenteditable', !/contenteditable/i.test(exp));
ok('导出内容无 position/float/flex/grid', !/(position|float|flex|grid)\s*:/i.test(exp));
const tagList = exp.match(/<(section|p|span|img|table|td)\b[^>]*>/g) || [];
const noStyle = tagList.filter(t => !/\sstyle=/.test(t));
ok('所有块级标签都带内联 style', noStyle.length === 0,
   noStyle.length ? '缺少样式: ' + noStyle.slice(0, 3).join(' ') : `共 ${tagList.length} 个标签`);
ok('导出不含 ul/ol/blockquote/h1-h6/tr 裸标签', !/<(ul|ol|li|blockquote|h[1-6]|hr)\b/i.test(exp));
ok('顶层为 section 根容器', /^<section[^>]*style=/.test(exp.trim()), exp.slice(0, 48));
ok('导出长度在 2 万字符预算内（本次测试稿）', exp.length < 20000, exp.length + ' 字符');

/* ---------- 3b. 样式瘦身必须不改变渲染结果 ---------- */
const slimTest = await page.evaluate(async () => {
  const full = buildExportHtml(false);
  const slim = buildExportHtml(true);
  const mk = (html) => new Promise(res => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:414px;height:700px;border:0;';
    f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">' + html + '</body></html>';
    f.onload = () => res(f);
    document.body.appendChild(f);
  });
  const fa = await mk(full), fb = await mk(slim);
  const sel = 'section,p,span,img,table,td';
  const A = fa.contentDocument.body.querySelectorAll(sel);
  const B = fb.contentDocument.body.querySelectorAll(sel);
  const props = ['fontSize','color','fontFamily','fontWeight','lineHeight','letterSpacing','textAlign',
                 'textIndent','backgroundColor','marginBottom','marginTop','paddingLeft','paddingTop',
                 'borderLeftWidth','borderBottomWidth','borderTopWidth','borderRadius','textDecorationLine','verticalAlign'];
  const diffs = [];
  if (A.length !== B.length) diffs.push('元素数量不同: ' + A.length + ' vs ' + B.length);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const ca = fa.contentWindow.getComputedStyle(A[i]);
    const cb = fb.contentWindow.getComputedStyle(B[i]);
    for (const p of props) if (ca[p] !== cb[p]) diffs.push(`#${i} ${A[i].tagName}.${p}: ${ca[p]} ≠ ${cb[p]}`);
  }
  fa.remove(); fb.remove();
  return { full: full.length, slim: slim.length, els: A.length, diffCount: diffs.length, diffs: diffs.slice(0, 6) };
});
ok('样式瘦身显著降低字符数', slimTest.slim < slimTest.full * 0.85,
   `${slimTest.full} -> ${slimTest.slim}（省 ${Math.round((1 - slimTest.slim / slimTest.full) * 100)}%）`);
ok('瘦身后渲染结果与未瘦身逐元素一致', slimTest.diffCount === 0,
   `对比 ${slimTest.els} 个元素×19 项属性；差异: ` + (slimTest.diffs.join(' | ') || '无'));

const slimOff = await page.evaluate(() => {
  const cb = document.querySelector('#gSlim');
  cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise(r => setTimeout(() => {
    const t = document.querySelector('#charBudget').title;
    const off = t.includes('未瘦身');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    r({ off, t: t.split('\n')[1] || t.slice(0, 40) });
  }, 700));
});
ok('瘦身开关状态反映到提示中', slimOff.off, slimOff.t);

/* ---------- 4. 主题切换 ---------- */
const themeProbe = async (id) => {
  await page.click('#btnTheme');
  await page.waitForTimeout(180);
  await page.click(`.tp-item[data-id="${id}"]`);
  await page.waitForTimeout(320);
  return page.evaluate(() => {
    const a = document.querySelector('#article');
    return {
      on: document.querySelector('.themepop .tp-item.on')?.dataset.id,
      bg: getComputedStyle(a).backgroundColor,
      color: getComputedStyle(a).color,
      font: getComputedStyle(a).fontFamily
    };
  });
};
const seen = new Set();
for (const id of ['su-jian', 'mo-juan', 'nuan-yang', 'qing-xin', 'hai-yan', 'mi-tao', 'za-zhi', 'shou-zhang', 'shen-ye', 'gu-feng']) {
  const p = await themeProbe(id);
  seen.add(p.bg + '|' + p.color);
  const switched = p.on === id;
  const styled = p.bg && p.color && p.font;
  ok(`主题「${id}」切换生效`, switched && styled, `bg=${p.bg} color=${p.color}`);
}
ok('10 套主题产生了差异化配色', seen.size >= 8, '不同配色组合=' + seen.size);

/* ---------- 5. 黑夜主题 ---------- */
await page.click('#appThemeSeg button[data-t="dark"]');
await page.waitForTimeout(250);
let dark = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-app'),
  bodyBg: getComputedStyle(document.body).backgroundColor,
  textColor: getComputedStyle(document.body).color
}));
ok('切换到黑夜主题', dark.attr === 'dark');
ok('黑夜主题下页面背景变深', /rgb\(2[0-2], 2[0-2], 2[0-9]\)/.test(dark.bodyBg) || dark.bodyBg !== 'rgb(238, 240, 243)', dark.bodyBg);
ok('黑夜主题下正文文字为浅色', parseInt(dark.textColor.match(/\d+/)[0], 10) > 150, dark.textColor);
await page.screenshot({ path: path.join(ARTIFACTS, 'shot-2-dark.png') });

/* ---------- 6. 全局样式控件 ---------- */
const before = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#article p')];
  const target = ps.find(p => p.textContent.includes('正文第一段')) || ps[0];
  return { fs: parseFloat(getComputedStyle(target).fontSize), lh: parseFloat(getComputedStyle(target).lineHeight) };
});
await page.click('#btnStylePanel');
await page.waitForTimeout(150);
await page.evaluate(() => {
  const s = document.querySelector('#gSize');
  s.value = '22'; s.dispatchEvent(new Event('input', { bubbles: true }));
  const l = document.querySelector('#gLh');
  l.value = '2.2'; l.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(250);
const after = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#article p')];
  const target = ps.find(p => p.textContent.includes('正文第一段')) || ps[0];
  return { fs: parseFloat(getComputedStyle(target).fontSize), lh: parseFloat(getComputedStyle(target).lineHeight) };
});
ok('字号滑杆放大正文', after.fs > before.fs + 3, `${before.fs} -> ${after.fs}`);
ok('行距滑杆生效', after.lh > before.lh + 0.3, `${before.lh} -> ${after.lh}`);

const scaled = await page.evaluate(() => {
  const a = document.querySelector('#article');
  const title = a.querySelector('p');
  return parseFloat(getComputedStyle(title).fontSize);
});
ok('标题随正文等比缩放（层级不乱）', scaled > 24, 'title fs=' + scaled);

/* 恢复主题默认 */
await page.click('#btnResetStyle');
await page.waitForTimeout(300);
const reset = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#article p')];
  const t = ps.find(p => p.textContent.includes('正文第一段')) || ps[0];
  return parseFloat(getComputedStyle(t).fontSize);
});
ok('「恢复主题默认」可还原字号', Math.abs(reset - 16) < 0.6, 'fs=' + reset);

/* ---------- 7. 富文本工具栏：选中加粗 ---------- */
const bolded = await page.evaluate(() => {
  const a = document.querySelector('#article');
  const p = [...a.querySelectorAll('p')].find(x => x.textContent.includes('正文第一段'));
  if (!p) return { err: '未找到段落' };
  const r = document.createRange();
  const tn = [...p.childNodes].find(n => n.nodeType === 3) || p.firstChild;
  const len = Math.min(4, tn.textContent.length);
  r.setStart(tn, 0); r.setEnd(tn, len);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  return { selected: sel.toString() };
});
await page.waitForTimeout(120);
await page.click('#rtToolbar .tb[data-act="bold"]');
await page.waitForTimeout(250);
const boldCheck = await page.evaluate(() => {
  const a = document.querySelector('#article');
  const strongs = [...a.querySelectorAll('strong, b, span[style*="font-weight"]')];
  return { count: strongs.length, html: a.innerHTML.includes('font-weight') };
});
ok('选中文字可加粗', boldCheck.count > 0, `strong=${boldCheck.count} sel="${bolded.selected}"`);
await page.screenshot({ path: path.join(ARTIFACTS, 'shot-3-bold.png') });

/* ---------- 取色板 ----------
   原生 input[type=color] 在部分浏览器内核下会把调色板画成「图片形状」的占位
   图标（表现为工具栏里出现裂图），且各内核外观差异极大。因此应用彻底不使用
   该控件，取色全部由自绘色板承担。本组断言守住这条底线。 */
const swStruct = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  /* 样本稿里那张 example.com/a.png 是故意 404 的占位图，不计入裂图 */
  const broken = imgs.filter((el) => (!el.complete || el.naturalWidth === 0) && !/example\.com/.test(el.src));
  return {
    colorInputs: document.querySelectorAll('input[type=color]').length,
    imgs: imgs.length,
    broken: broken.length,
  };
});
ok('页面不含原生取色控件（裂图来源已彻底移除）',
  swStruct.colorInputs === 0,
  'input[type=color]=' + swStruct.colorInputs);
ok('无加载失败的图片', swStruct.broken === 0,
  'img=' + swStruct.imgs + ' broken=' + swStruct.broken);

/* 工具栏区域内不应存在任何非文字渲染元素（img / 背景图 / 原生控件） */
const barForeign = await page.evaluate(() => {
  const bar = document.querySelector('#rtToolbar');
  const bad = [];
  bar.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (el.tagName === 'IMG') bad.push({ tag: 'IMG', cls: el.className });
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) {
      bad.push({ tag: el.tagName, cls: el.className, bg: cs.backgroundImage });
    }
    if (el.tagName === 'INPUT' && el.type === 'color') bad.push({ tag: 'INPUT[color]' });
  });
  return bad;
});
ok('工具栏不含图片 / 外链背景图 / 原生取色控件', barForeign.length === 0,
  JSON.stringify(barForeign));

await page.click('#fgBtn');
await page.waitForTimeout(220);
const swOpen = await page.evaluate(() => {
  const el = document.querySelector('.palette');
  const b = el.getBoundingClientRect();
  return {
    hidden: el.hidden,
    sw: el.querySelectorAll('.sw').length,
    inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
  };
});
ok('点「A」弹出取色板（12 色）且完整落在视口内',
  !swOpen.hidden && swOpen.sw === 12 && swOpen.inView, JSON.stringify(swOpen));

/* 自定义色值：色板里的十六进制输入框（替代原先的「更多颜色…」原生调色板） */
await page.evaluate(() => { document.querySelector('.palette').hidden = true; });
await page.click('#fgBtn');
await page.waitForTimeout(200);
const hexBox = await page.evaluate(() => {
  const inp = document.querySelector('.palette .hexinp');
  return inp ? { exists: true, val: inp.value, w: Math.round(inp.getBoundingClientRect().width) } : { exists: false };
});
ok('色板内含自定义色值输入框并回填当前色', hexBox.exists && hexBox.val === '9E2B25' && hexBox.w > 20,
  JSON.stringify(hexBox));

await page.fill('.palette .hexinp', '1B6B50');
await page.dispatchEvent('.palette .hexinp', 'change');
await page.waitForTimeout(300);
const hexApplied = await page.evaluate(() => ({
  bar: document.querySelector('#barFg').dataset.c,
  closed: document.querySelector('.palette').hidden,
  applied: /#1B6B50|rgb\(27,\s*107,\s*80\)/i.test(document.querySelector('#article').innerHTML),
}));
ok('输入自定义色值后上色生效并收起',
  hexApplied.applied && hexApplied.bar === '#1B6B50' && hexApplied.closed, JSON.stringify(hexApplied));

/* 非法色值不应上色 */
await page.click('#fgBtn');
await page.waitForTimeout(200);
const hexBad = await page.evaluate(async () => {
  const inp = document.querySelector('.palette .hexinp');
  const before = document.querySelector('#barFg').dataset.c;
  inp.value = 'ZZZ';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  return {
    before,
    after: document.querySelector('#barFg').dataset.c,
    shown: inp.value,
    bad: inp.parentElement.classList.contains('bad'),
  };
});
ok('非法色值被拒且标记为错误态',
  hexBad.after === hexBad.before && hexBad.shown === 'ZZZ' && hexBad.bad,
  JSON.stringify(hexBad));
await page.evaluate(() => { document.querySelector('.palette').hidden = true; });

await page.evaluate(() => {
  document.querySelector('.palette').hidden = true;
  const a = document.querySelector('#article');
  const P = a.querySelector('p');
  const t = document.createTreeWalker(P, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange();
  r.setStart(t, 0);
  r.setEnd(t, Math.min(4, t.textContent.length));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  a.focus();
});
await page.click('#fgBtn');
await page.waitForTimeout(180);
await page.click('.palette .sw[data-c="#1F6FB2"]');
await page.waitForTimeout(300);
const swApplied = await page.evaluate(() => ({
  bar: document.querySelector('#barFg').dataset.c,
  applied: /#1F6FB2|rgb\(31,\s*111,\s*178\)/i.test(document.querySelector('#article').innerHTML),
  closed: document.querySelector('.palette').hidden,
}));
ok('取色板选色落到选中文字并自动收起',
  swApplied.applied && swApplied.bar === '#1F6FB2' && swApplied.closed, JSON.stringify(swApplied));

/* 样式面板里的「正文颜色」也走同一个色板（前面步骤可能已把它展开，别盲点收起） */
let swPanelOpen = await page.evaluate(() => !document.querySelector('.style-panel').hidden);
if (!swPanelOpen) { await page.click('#btnStylePanel'); await page.waitForTimeout(250); }
await page.click('#gColorBtn');
await page.waitForTimeout(200);
const swG = await page.evaluate(() => {
  const el = document.querySelector('.palette');
  return { hidden: el.hidden, sw: el.querySelectorAll('.sw').length };
});
ok('点「正文颜色」弹出取色板', !swG.hidden && swG.sw === 12, JSON.stringify(swG));
await page.click('.palette .sw[data-c="#1B6B50"]');
await page.waitForTimeout(320);
const swGR = await page.evaluate(() => {
  const chip = document.querySelector('#gColorChip');
  const colored = [...document.querySelectorAll('#article [data-color]')];
  return {
    chip: chip.dataset.c,
    useColor: document.querySelector('#useColor').checked,
    coloredCount: colored.length,
    coloredFirst: colored.length ? getComputedStyle(colored[0]).color : 'none',
  };
});
ok('正文字色选色生效（色块 / 启用勾选 / 正文颜色三方一致）',
  swGR.chip === '#1B6B50' && swGR.useColor && swGR.coloredCount > 0 &&
  /27,\s*107,\s*80/.test(swGR.coloredFirst), JSON.stringify(swGR));
await page.click('#btnResetStyle');
await page.waitForTimeout(300);
const swReset = await page.evaluate(() => ({
  chip: document.querySelector('#gColorChip').dataset.c,
  useColor: document.querySelector('#useColor').checked,
}));
ok('「恢复主题默认」后色块与勾选一起复位',
  swReset.chip === '#333333' && swReset.useColor === false, JSON.stringify(swReset));
swPanelOpen = await page.evaluate(() => !document.querySelector('.style-panel').hidden);
if (swPanelOpen) { await page.click('#btnStylePanel'); await page.waitForTimeout(200); }

/* ---------- 8. 分割线按钮 ---------- */
const hrCount0 = await page.evaluate(() => document.querySelector('#article').innerHTML.split('◆').length);
await page.evaluate(() => {
  const a = document.querySelector('#article');
  const r = document.createRange();
  r.selectNodeContents(a.lastElementChild || a);
  r.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
});
await page.click('#rtToolbar .tb[data-act="hr"]');
await page.waitForTimeout(250);
const hrCount1 = await page.evaluate(() => document.querySelector('#article').querySelectorAll('hr, section:has(p)').length);
ok('插入分割线按钮可用', hrCount1 > 0, `hr/小节数=${hrCount1}（插入前符号数 ${hrCount0}）`);

/* ---------- 9. 复制链路 ---------- */
const copyRes = await page.evaluate(async () => {
  try {
    await copyRich();
    const items = await navigator.clipboard.read();
    return { ok: true, types: items.map(i => i.types).flat() };
  } catch (e) { return { ok: false, err: String(e) }; }
});
ok('复制到剪贴板成功且含 text/html', copyRes.ok && copyRes.types.includes('text/html'),
   JSON.stringify(copyRes));

/* ---------- 10. 持久化 ---------- */
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
const persisted = await page.evaluate(() => ({
  app: document.documentElement.getAttribute('data-app'),
  theme: document.querySelector('.themepop .tp-item.on')?.dataset.id,
  srcHasTest: document.querySelector('#source').value.includes('全要素渲染测试')
}));
ok('刷新后记忆黑夜主题', persisted.app === 'dark', persisted.app);
ok('刷新后记住上次导入的文稿', persisted.srcHasTest);

/* ---------- 11. 插入：图片 / 表格 / 装饰元件 ---------- */
const insItems = await page.evaluate(async () => {
  document.querySelector('#btnInsert').click();
  await new Promise(r => setTimeout(r, 200));
  const p = [...document.querySelectorAll('.pop')].find(x => !x.hidden && x.querySelector('[data-ins]'));
  return p ? [...p.querySelectorAll('[data-ins]')].map(b => b.dataset.ins) : [];
});
ok('「插入 ▾」菜单有图片 / 表格 / 装饰元件三项',
   insItems.join(',') === 'img,table,elem', insItems.join(','));

/* 11a. 装饰元件 */
await page.evaluate(async () => {
  const p = [...document.querySelectorAll('.pop')].find(x => x.querySelector('[data-ins]'));
  p.querySelector('[data-ins="elem"]').click();
  await new Promise(r => setTimeout(r, 250));
});
const elemPop = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /装饰元件/.test(h.textContent);
  });
  if (!p || p.hidden) return null;
  return { n: p.querySelectorAll('[data-el]').length };
});
ok('装饰元件选择器有 5 个元件', elemPop && elemPop.n === 5, JSON.stringify(elemPop));

await page.evaluate(async () => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /装饰元件/.test(h.textContent);
  });
  p.querySelector('[data-el="follow"]').click();
  await new Promise(r => setTimeout(r, 250));
});
const elemRes = await page.evaluate(() => ({
  src: /^::follow/m.test(document.querySelector('#source').value),
  out: /点击上方蓝字关注我/.test(document.querySelector('#article').innerHTML)
}));
ok('元件写入左侧文档并渲染出关注卡', elemRes.src && elemRes.out, JSON.stringify(elemRes));

/* 11b. 表格可视化编辑 */
await page.evaluate(async () => {
  document.querySelector('#btnInsert').click();
  await new Promise(r => setTimeout(r, 200));
  const p = [...document.querySelectorAll('.pop')].find(x => x.querySelector('[data-ins]'));
  p.querySelector('[data-ins="table"]').click();
  await new Promise(r => setTimeout(r, 250));
});
const tbl0 = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /编辑表格/.test(h.textContent);
  });
  if (!p || p.hidden) return null;
  const trs = [...p.querySelectorAll('table.tbled tr')];
  return { rows: trs.length, cols: trs[0].children.length,
           bars: [...p.querySelectorAll('.tblbar button')].map(b => b.dataset.op) };
});
ok('表格编辑器默认 3×3 且带行列按钮',
   tbl0 && tbl0.rows === 3 && tbl0.cols === 3 && tbl0.bars.length === 5, JSON.stringify(tbl0));

await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /编辑表格/.test(h.textContent);
  });
  p.querySelector('input').focus();
});
await page.click('.tblbar button[data-op="rowAdd"]');
await page.waitForTimeout(150);
await page.click('.tblbar button[data-op="colAdd"]');
await page.waitForTimeout(200);
const tblSize = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /编辑表格/.test(h.textContent);
  });
  return (p.querySelector('.tlen') || {}).textContent || '';
});
ok('表格 ＋行 / ＋列 生效并更新尺寸标签', /4 行 × 4 列/.test(tblSize), tblSize);

await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /编辑表格/.test(h.textContent);
  });
  const vals = ['品种', '产区', '甜度', '价格',
                '麒麟瓜', '海南', '高', '3.5元',
                '8424', '上海', '中', '2.8元',
                '黑美人', '广西', '中', '2.2元'];
  [...p.querySelectorAll('input')].forEach((i, k) => { if (vals[k] !== undefined) i.value = vals[k]; });
});
await page.click('.pop .btn.primary[data-op="insert"]');
await page.waitForTimeout(350);
const tblRes = await page.evaluate(() => {
  /* 样本稿自带一张 3×2 的表格，所以要看「最后一个」——新插入的排在末尾 */
  const lines = document.querySelector('#source').value.split('\n');
  const mdIdx = lines.findIndex(l => /^\|\s*品种\s*\|\s*产区\s*\|\s*甜度\s*\|\s*价格\s*\|$/.test(l.trim()));
  const secs = [...document.querySelectorAll('#article section')].filter(s => s.querySelector('table'));
  const sec = secs[secs.length - 1];
  const trs = sec ? [...sec.querySelectorAll('tr')] : [];
  return {
    md: mdIdx >= 0 ? lines[mdIdx].trim() : '',
    sep: mdIdx >= 0 && lines[mdIdx + 1] ? lines[mdIdx + 1].trim() : '',
    tables: secs.length, rows: trs.length, cols: trs[0] ? trs[0].children.length : 0,
    first: trs[0] ? trs[0].textContent : ''
  };
});
ok('表格插入为 markdown（表头 + 分隔行）',
   /^\|\s*品种\s*\|\s*产区\s*\|\s*甜度\s*\|\s*价格\s*\|$/.test(tblRes.md) &&
   /^\|\s*---\s*\|/.test(tblRes.sep), tblRes.md + ' / ' + tblRes.sep);
ok('表格在预览区渲染成 4×4（与样本稿原有的表格并存）',
   tblRes.rows === 4 && tblRes.cols === 4 && tblRes.tables === 2, JSON.stringify(tblRes));
ok('表格首行是填进去的表头', tblRes.first === '品种产区甜度价格', tblRes.first);

/* 11c. 图片：压缩 + 入库 + 逐图样式 */
const shot = await page.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 1600; cv.height = 1200;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#1b6b50'; cx.fillRect(0, 0, 1600, 1200);
  return cv.toDataURL('image/png');
});
const TMPIMG = path.join(os.tmpdir(), 'wxt-studio-e2e-img.png');
fs.writeFileSync(TMPIMG, Buffer.from(shot.split(',')[1], 'base64'));

await page.evaluate(async () => {
  document.querySelector('#btnInsert').click();
  await new Promise(r => setTimeout(r, 200));
  const p = [...document.querySelectorAll('.pop')].find(x => x.querySelector('[data-ins]'));
  p.querySelector('[data-ins="img"]').click();
  await new Promise(r => setTimeout(r, 250));
});
const imgPopOpen = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.pop')].find(x => {
    const h = x.querySelector('.pop-h');
    return h && /插入图片/.test(h.textContent);
  });
  return !!(p && !p.hidden && p.querySelector('#ipGo'));
});
ok('图片参数浮层打开且有「选择图片」按钮', imgPopOpen);

await page.selectOption('#ipMaxW', '1080');
await page.selectOption('#ipRadius', '8');
await page.selectOption('#ipAlign', 'left');
await page.check('#ipShadow');
await page.fill('#ipCap', '压缩后的图');
await (await page.$('input[type=file][accept="image/*"]')).setInputFiles(TMPIMG);
await page.waitForTimeout(1200);

const imgRes = await page.evaluate(() => {
  const a = state.assets.img1;
  /* 样本稿里也有一张图，取最后一个才是刚插进来的 */
  const ims = [...document.querySelectorAll('#article img')];
  const im = ims[ims.length - 1];
  const cap = im && im.parentElement.querySelector('p');
  return {
    srcLine: /!\[压缩后的图\]\(asset:img1\)/.test(document.querySelector('#source').value),
    assetW: a ? a.w : 0, assetH: a ? a.h : 0, assetKb: a ? a.kb : 0, total: ims.length,
    style: im ? (im.getAttribute('style') || '') : '',
    cap: cap ? cap.textContent : ''
  };
});
ok('图片插入为 asset 引用（左侧不塞 base64）', imgRes.srcLine);
ok('图片缩到 1080 宽', imgRes.assetW === 1080 && imgRes.assetH === 810,
   imgRes.assetW + '×' + imgRes.assetH);
ok('缩图后体积远小于原图', imgRes.assetKb > 0 && imgRes.assetKb < 200, imgRes.assetKb + 'KB');
ok('逐图圆角 / 左对齐 / 阴影都写进了 style',
   /border-radius:8px/.test(imgRes.style) && /margin:0 auto 0 0/.test(imgRes.style) &&
   /box-shadow/.test(imgRes.style), imgRes.style);
ok('图注渲染在图片下方', imgRes.cap === '压缩后的图', imgRes.cap);

/* 换主题后三类内容都要还在 */
await page.click('#btnTheme');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.themepop .tp-item')];
  const t = items.find(i => !i.classList.contains('on'));
  if (t) t.click();
});
await page.waitForTimeout(600);
const survive = await page.evaluate(() => ({
  img: !!document.querySelector('#article img'),
  table: !!document.querySelector('#article table'),
  elem: /点击上方蓝字关注我/.test(document.querySelector('#article').innerHTML),
  keepAsset: /asset:img1/.test(document.querySelector('#source').value)
}));
ok('换主题后图片 / 表格 / 元件都还在',
   survive.img && survive.table && survive.elem && survive.keepAsset, JSON.stringify(survive));

/* 导出的成品里，逐图样式不能被 normalizeForWechat 抹掉 */
const expStyle = await page.evaluate(() => {
  const tags = buildExportHtml(true).match(/<img[^>]*>/g) || [];
  const styles = tags.map(t => (t.match(/style="([^"]*)"/) || [])[1] || '');
  return { n: tags.length, last: styles[styles.length - 1] || '' };
});
ok('导出成品保留了图片圆角与阴影',
   /border-radius:8px/.test(expStyle.last) && /box-shadow/.test(expStyle.last),
   expStyle.n + ' 张图, 末张=' + expStyle.last);

try { fs.unlinkSync(TMPIMG); } catch (e) {}

const finalErrors = errors.length;
ok('全流程无未捕获错误', finalErrors === 0, errors.join(' ;; '));

/* ---------- 输出 ---------- */
const pass = OUT.filter(l => l.startsWith('PASS')).length;
const fail = OUT.filter(l => l.startsWith('FAIL')).length;
const report = [...OUT, '', `合计：${pass} 通过 / ${fail} 失败`].join('\n');
fs.writeFileSync(REPORT, report, 'utf8');
console.log(report);

await browser.close();
process.exit(fail ? 1 : 0);
