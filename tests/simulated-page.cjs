const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.TREND_PLAYWRIGHT || 'playwright-core');

(async () => {
  const browser = await chromium.launch({
    channel: process.env.TREND_BROWSER || 'chrome',
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    await page.evaluate(() => {
      const host = document.querySelector('main');
      const mock = window.mock = { submits: [], pageIndex: 0, drawerPage: 0, silent: false, submitted: {} };
      window.chrome.runtime = { id: 'mock', onMessage: { addListener(fn) { window.listener = fn; } } };
      window.command = (command, sections) => {
        let result;
        window.listener({ source: 'trend-assistant', command, sections }, { id: 'mock' }, data => { result = data; });
        return result;
      };
      function render(section = '市场趋势', sub = '相似款稀缺') {
        host.innerHTML = `
          <div aria-label="提报入口">${['市场趋势', '平台缺货'].map(label => '<button role="tab" aria-selected="' + (section === label) + '">' + label + '</button>').join('')}</div>
          ${section === '平台缺货' ? '<div aria-label="缺货入口">' + ['相似款稀缺', '同款稀缺'].map(label => '<button role="tab" aria-selected="' + (sub === label) + '">' + label + '</button>').join('') + '</div>' : ''}
          <article data-opportunity-id="${section}-${sub}-${mock.pageIndex}"><h2 data-opportunity-title>${section === '市场趋势' ? '趋势' + mock.pageIndex : (mock.fallback && sub === '相似款稀缺' ? '秋季通勤针织开衫女装' : sub)}</h2><button>提报</button></article>
          ${section === '市场趋势' && mock.pageIndex === 0 ? '<button aria-label="下一页">下一页</button>' : ''}
        `;
        for (const node of host.querySelectorAll('[role="tab"]')) node.onclick = () => {
          mock.pageIndex = 0;
          const label = node.textContent;
          ['市场趋势', '平台缺货'].includes(label) ? render(label) : render(section, label);
        };
        host.querySelector('article button').onclick = () => {
          mock.drawerPage = 0;
          makeDrawer(section, sub);
        };
        const next = host.querySelector('[aria-label="下一页"]');
        if (next) next.onclick = () => { mock.pageIndex++; render(section, sub); };
      }
      function makeDrawer(section, sub, replace = null) {
        const single = section === '平台缺货' && sub === '同款稀缺';
        const similar = section === '平台缺货' && sub === '相似款稀缺';
        const base = 123400 + (section === '市场趋势' ? mock.pageIndex * 10 : single ? 30 : 50) + mock.drawerPage * (similar ? 8 : 4);
        const root = replace || document.createElement('section');
        root.setAttribute('role', 'dialog');
        root.innerHTML = `
          <button aria-label="关闭" type="button">关闭</button>
          ${similar ? '<input placeholder="商品关键词"><button type="button">搜索</button>' : ''}
          <p>单次最多可提报 1 件</p>
          <table><tbody></tbody></table>
          ${single ? '' : '<button type="button">批量提报</button>'}
          ${((section === '市场趋势' && mock.pageIndex === 0) || similar) && mock.drawerPage === 0 ? '<button aria-label="下一页">下一页</button>' : ''}
        `;
        const fillRows = (start, label) => {
          root.querySelector('tbody').innerHTML = [0, 1, 2].map(index => {
            const id = String(start + index);
            const done = index === 2 || mock.submitted[id];
            return '<tr data-item-id="' + id + '"><td>' + label + id + '</td><td>' + (done ? '已提报' : single ? '<button>提报</button>' : '<input type="checkbox">') + '</td></tr>';
          }).join('');
          if (!single) root.querySelector('tbody').insertAdjacentHTML('afterbegin',
            '<tr><td colspan="6">暂无可匹配的补充商品</td><td><input type="checkbox"></td></tr>');
          for (const button of root.querySelectorAll('td button')) button.onclick = () => submit([button.closest('tr')]);
        };
        function submit(rows) {
          const ids = rows.map(row => row.dataset.itemId);
          mock.submits.push(ids);
          if (mock.silent) return;
          for (const row of rows) {
            mock.submitted[row.dataset.itemId] = true;
            row.lastElementChild.textContent = '审核中';
          }
        }
        fillRows(base, '商品');
        if (mock.marketAll && section === '市场趋势') {
          root.insertAdjacentHTML('afterbegin', '<p>没有符合条件时请检查商机要求。</p>');
          if (mock.pageIndex === 1) {
            root.querySelector('tbody').innerHTML = '<tr><td colspan="6">暂无数据</td></tr>';
          }
        }
        root.querySelector('[aria-label="关闭"]').onclick = () => root.remove();
        if (similar) [...root.querySelectorAll('button')].find(node => node.textContent === '搜索').onclick = () => {
          const keyword = root.querySelector('input').value;
          if (!mock.fallback) { fillRows(base + 4, keyword); return; }
          mock.searches.push(keyword);
          if (keyword === '秋季通勤针织开衫女装') {
            root.querySelector('tbody').innerHTML = '<tr><td colspan="6">暂无数据</td></tr>';
            return;
          }
          fillRows(base + 4, keyword);
          root.querySelector('tbody tr:nth-child(3) td').textContent = '通勤长袖衬衫';
        };
        const batch = [...root.querySelectorAll('button')].find(node => node.textContent === '批量提报');
        if (batch) batch.onclick = () => submit([...root.querySelectorAll('input:checked')].map(node => node.closest('tr')));
        const next = root.querySelector('[aria-label="下一页"]');
        if (next) next.onclick = () => { mock.drawerPage++; makeDrawer(section, sub, root); };
        if (!replace) host.append(root);
      }
      window.renderFixture = render;
      render();
    });
    await page.addScriptTag({ path: path.join(__dirname, '../extension/trend.js') });
    async function run(command, sections) {
      await page.evaluate(([action, keys]) => window.command(action, keys), [command, sections]);
      await page.waitForFunction(() => !window.command('status').running, null, { timeout: 18000 });
      return page.evaluate(() => ({ state: window.command('status'), submits: window.mock.submits }));
    }
    let result = await run('scan', ['market', 'similar', 'same']);
    assert.match(result.state.status, /扫描完成，处理商机 4 个/);
    assert.equal(result.submits.length, 0);
    await page.evaluate(() => { window.mock.pageIndex = 0; window.renderFixture(); });
    result = await run('start', ['market', 'similar', 'same']);
    assert.match(result.state.status, /提报流程结束，处理商机 4 个/);
    assert.equal(result.submits.length, 10);
    assert.ok(result.submits.every(ids => ids.length === 1));
    assert.equal(new Set(result.submits.flat()).size, 10);
    assert.ok(!result.submits.flat().includes('123402'));
    assert.ok(result.submits.flat().includes('123454'));
    assert.ok(result.state.log.some(line => line.includes('跳过 1 条无法唯一识别商品 ID')));
    await page.evaluate(() => {
      window.mock.fallback = true;
      window.mock.searches = [];
      window.mock.submits = [];
      window.mock.submitted = {};
      window.mock.pageIndex = 0;
      window.renderFixture('平台缺货');
    });
    result = await run('start', ['similar']);
    assert.deepEqual(await page.evaluate(() => window.mock.searches), ['秋季通勤针织开衫女装', '针织开衫']);
    assert.deepEqual(result.submits.flat(), ['123454']);
    assert.ok(result.state.log.some(line => line.includes('完整标题无结果')));
    await page.evaluate(() => { window.mock.fallback = false; });
    await page.evaluate(() => {
      window.mock.marketAll = true;
      window.mock.submits = [];
      window.mock.submitted = {};
      window.mock.pageIndex = 0;
      window.renderFixture();
    });
    result = await run('startMarketAll');
    assert.match(result.state.status, /全量提报结束。已检查商机 2 个，平台已受理 4 件，空商机 1 个/);
    assert.deepEqual(result.submits.flat(), ['123400', '123401', '123404', '123405']);
    assert.ok(!result.state.log.some(line => /相似款稀缺|同款稀缺/.test(line)));
    await page.evaluate(() => { window.mock.marketAll = false; });
    await page.evaluate(() => {
      window.mock.submitted = {};
      window.mock.submits = [];
      window.mock.silent = true;
      window.mock.pageIndex = 0;
      window.renderFixture();
    });
    await page.evaluate(() => window.command('start', ['market']));
    await page.waitForFunction(() => window.command('status').paused, null, { timeout: 34000 });
    assert.equal(await page.evaluate(() => window.mock.submits.length), 1);
    await page.evaluate(() => {
      const id = window.mock.submits[0][0];
      document.querySelector('tr[data-item-id="' + id + '"]').lastElementChild.textContent = '审核中';
      window.mock.silent = false;
      window.command('resume');
    });
    await page.waitForFunction(() => !window.command('status').running);
    result = await page.evaluate(() => ({ state: window.command('status'), submits: window.mock.submits }));
    assert.match(result.state.status, /提报流程结束/);
    assert.equal(new Set(result.submits.flat()).size, result.submits.length);

    await page.evaluate(() => {
      delete window.__taobaoTrendAssistant;
      window.mock.submits = [];
      document.querySelector('main').innerHTML = '<button role="tab" aria-selected="true">全网爆款</button><button id="offer">提报同款</button>';
      document.querySelector('#offer').onclick = () => {
        document.querySelector('main').insertAdjacentHTML('beforeend',
          '<section role="dialog"><table><tr><td>选择同款SKU</td></tr></table><button id="confirm">确认报名</button></section>');
        document.querySelector('#confirm').onclick = () => window.mock.submits.push('unexpected');
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, '../extension/trend.js') });
    assert.equal(await page.evaluate(() => window.command('ready')), true);
    result = await run('startDefault');
    assert.match(result.state.status, /处理商机 0 个/);
    assert.equal(result.submits.length, 0);
    assert.equal(await page.locator('#confirm').count(), 0);
    console.log('PASS: scan without writes, all three branches, two pagination levels, batch limits, confirmed rows, pause and resume receipt without resubmit, no hot-product action.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});