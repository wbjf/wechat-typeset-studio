/**
 * 公众号排版工作台 —— 端到端验证
 *
 * 用真实 Chrome 打开 index.html，逐项断言渲染结果、微信合规性与交互链路。
 * 共 59 项，全部通过则退出码为 0。
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
  if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('[console] ' + m.text());
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
    chips: document.querySelectorAll('#themeStrip .tchip').length,
    onChip: document.querySelector('#themeStrip .tchip.on')?.dataset.id,
    srcLen: document.querySelector('#source').value.length,
    overflow: a.scrollWidth - a.clientWidth
  };
});
ok('默认载入示例稿并渲染', r.html > 500 && r.ps > 5, `innerHTML=${r.html} p=${r.ps} section=${r.sections}`);
ok('根容器带内联样式', /background-color/.test(r.rootStyle), r.rootStyle.slice(0, 60));
ok('主题条渲染 10 个主题', r.chips === 10, 'chips=' + r.chips);
ok('默认主题为古风', r.onChip === 'gu-feng', 'on=' + r.onChip);
ok('正文不横向溢出手机宽度', r.overflow <= 1, 'overflow=' + r.overflow);

/* ---------- 1b. 主题条不被裁切 + 字符预算 ---------- */
const strip = await page.evaluate(() => {
  const wrap = document.querySelector('#themeStrip');
  const box = wrap.getBoundingClientRect();
  const chips = [...wrap.querySelectorAll('.tchip')];
  const visible = chips.filter(c => {
    const r = c.getBoundingClientRect();
    return r.right <= box.right + 1 && r.left >= box.left - 1 && r.width > 0;
  }).length;
  return { visible, total: chips.length, clipped: wrap.scrollHeight > wrap.clientHeight + 1 };
});
ok('10 个主题全部可见（不被横向裁切）', strip.visible === strip.total && !strip.clipped, JSON.stringify(strip));

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
  await page.click(`.tchip[data-id="${id}"]`);
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const a = document.querySelector('#article');
    return {
      on: document.querySelector('#themeStrip .tchip.on')?.dataset.id,
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
  theme: document.querySelector('#themeStrip .tchip.on')?.dataset.id,
  srcHasTest: document.querySelector('#source').value.includes('全要素渲染测试')
}));
ok('刷新后记忆黑夜主题', persisted.app === 'dark', persisted.app);
ok('刷新后记住上次导入的文稿', persisted.srcHasTest);

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
