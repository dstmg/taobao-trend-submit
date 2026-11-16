(() => {
  if (globalThis.__taobaoTrendAssistant) return;
  globalThis.__taobaoTrendAssistant = true;
  const sections = {
    market: { name: '市场趋势', tabs: ['市场趋势'] },
    similar: { name: '相似款稀缺', tabs: ['平台缺货', '相似款稀缺'], search: true },
    same: { name: '同款稀缺', tabs: ['平台缺货', '同款稀缺'], single: true }
  };
  const selectors = {
    dialog: '.next-drawer, [role="dialog"], [class*="drawer"][aria-hidden="false"]',
    tab: '[role="tab"], .next-tabs-tab',
    next: '[aria-label*="下一页"], [title*="下一页"], .next-pagination-next',
    success: '.next-message-success, .ant-message-success, [role="status"]',
    error: '.next-message-error, .ant-message-error, .next-feedback-error'
  };
  const confirmed = /已提报|已报名|审核中|审核通过|已通过|已生效|已扶持|撤销提报/;
  const rejected = /已驳回|提报失败|报名失败/;
  const state = { running: false, paused: false, unresolved: false, stop: false, status: '就绪', log: [] };
  const text = node => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length &&
    getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"]'));
  const enabled = node => visible(node) && !node.matches(':disabled, [aria-disabled="true"], .next-disabled, .disabled') &&
    !node.closest('.next-disabled, [aria-disabled="true"]');
  const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  const buttons = (root, label) => all(root, 'button').filter(node => text(node) === label && enabled(node));
  const delay = time => new Promise(resolve => setTimeout(resolve, time));
  const tab = name => all(document, selectors.tab).find(node => text(node) === name);
  const activeTab = name => tab(name)?.matches('[aria-selected="true"], .next-tabs-tab-active, .active');
  const drawer = () => all(document, selectors.dialog).find(node => node.querySelector('table, input, [role="table"], [role="grid"]'));
  const rowList = root => all(root, 'tr, [role="row"]').filter(row => row.querySelector('td, [role="cell"], [role="gridcell"]'));
  const checkbox = row => row.querySelector('input[type="checkbox"]');
  const rowButton = row => buttons(row, '提报')[0];
  const signal = selector => all(document, selector).map(node => [node, text(node)]);
  const verifyCaptcha = () => {
    const challenge = all(document, 'iframe, [role="dialog"], .nc-container, .baxia-dialog').find(node =>
      /captcha|baxia|punish|安全验证|滑动验证|人机验证/i.test(
        (node.getAttribute('src') || '') + ' ' + (node.getAttribute('title') || '') + ' ' + text(node).slice(0, 250)));
    if (challenge) throw new Error('页面出现安全验证，本轮已停止。');
  };

  function log(message) {
    state.log.push(message);
    if (state.log.length > 150) state.log.shift();
  }

  async function waitFor(read, timeout = 5500, observeAfterStop = false) {
    const end = Date.now() + timeout;
    do {
      verifyCaptcha();
      if (!observeAfterStop && state.stop) return null;
      const result = read();
      if (result) return result;
      await delay(100);
    } while (Date.now() < end);
    return null;
  }

  function productId(row) {
    for (const key of ['data-item-id', 'data-product-id']) {
      const value = row.getAttribute(key);
      if (/^\d{6,}$/.test(value || '')) return value;
    }
    const label = text(row).match(/商品\s*ID\s*[:：]?\s*(\d{6,})/i)?.[1];
    if (label) return label;
    const candidates = new Set();
    for (const link of row.querySelectorAll('a[href]')) {
      const url = new URL(link.href);
      let value;
      if (['item.taobao.com', 'detail.tmall.com'].includes(url.hostname)) {
        value = url.searchParams.get('id');
      } else if (url.hostname === 'item.upload.taobao.com' && url.pathname.startsWith('/sell/v2/')) {
        value = url.searchParams.get('itemId');
      }
      if (/^\d{6,}$/.test(value || '')) candidates.add(value);
    }
    return candidates.size === 1 ? [...candidates][0] : null;
  }

  function opportunities() {
    const cards = new Map();
    for (const button of buttons(document, '提报')) {
      if (button.closest(selectors.dialog)) continue;
      let container = button.parentElement;
      for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
        const title = container.querySelector('[class*="opportunityTitle"], [data-opportunity-title]');
        if (!title) continue;
        if (!confirmed.test(text(container))) {
          const key = [text(title), container.getAttribute('data-opportunity-id') || container.id || '', container.querySelector('img')?.getAttribute('src') || ''].join('|');
          if (!cards.has(key)) cards.set(key, { key, title: text(title), button });
        }
        break;
      }
    }
    return cards;
  }

  async function activate(name) {
    const node = tab(name);
    if (!node) throw new Error('页面没有「' + name + '」入口。');
    const active = () => activeTab(name);
    if (active()) return;
    if (!enabled(node)) throw new Error('入口当前不可用：' + name);
    node.click();
    if (!await waitFor(active)) throw new Error('未确认入口已切换：' + name);
  }

  async function closeDrawer(root) {
    if (!visible(root)) return;
    const close = all(root, '[aria-label*="关闭"], [aria-label*="Close"], .next-drawer-close, .ant-drawer-close').find(enabled);
    if (!close) throw new Error('抽屉仍开着，请检查当前页面。');
    close.click();
    const end = Date.now() + 3500;
    while (visible(root) && Date.now() < end) await delay(100);
    if (visible(root)) throw new Error('未确认商品抽屉已关闭。');
  }

  const emptySearchResult = /暂无数据|暂无商品|无可提报|没有相关商品|没有符合条件|未找到相关商品|没有相关类目的商品/;

  function apparelKeyword(title) {
    const style = /针织开衫|针织背心|针织衫|防晒衣|连衣裙|半身裙|百褶裙|牛仔裤|阔腿裤|直筒裤|喇叭裤|西装裤|羽绒服|冲锋衣|风衣|衬衫|卫衣|马甲|短裤|T恤/i;
    const keyword = title.match(style)?.[0];
    return keyword && keyword !== title ? keyword : null;
  }
  async function search(root, title) {
    const field = await waitFor(() => all(root, 'input').find(node => /关键词/.test(node.placeholder || '') && enabled(node)));
    if (!field || !title) throw new Error('无法定位相似款搜索框。');
    const before = rowList(root);
    const signature = before.map(row => productId(row) || text(row)).join('|');
    const wasEmpty = emptySearchResult.test(text(root));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, title);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const button = buttons(root, '搜索')[0] || buttons(root, '查询')[0];
    if (button) button.click();
    else for (const type of ['keydown', 'keypress', 'keyup']) field.dispatchEvent(new KeyboardEvent(type,
      { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    const changed = await waitFor(() => {
      const rows = rowList(root);
      if (emptySearchResult.test(text(root))) return !wasEmpty || rows.some(row => !before.includes(row));
      return (rows.length > 0 && (rows.some(row => text(row).includes(title)) ||
        rows.map(row => productId(row) || text(row)).join('|') !== signature));
    });
    if (state.stop) return;
    if (!changed) throw new Error('无法确认相似款搜索结果已刷新。');
  }

  function eligible(root, single) {
    return rowList(root).filter(row => !confirmed.test(text(row)) && !rejected.test(text(row)) &&
      enabled(single ? rowButton(row) : checkbox(row)));
  }

  function pending(ids, title) {
    state.unresolved = true;
    throw new Error('提报结果待核实。请在当前千牛页面核对「' + title + '」商品 ' + ids.join('、') + '。本页已暂停再次提交。');
  }

  async function submit(root, rows, section, title) {
    const ids = rows.map(productId);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('在「' + title + '」中无法唯一识别商品 ID。');
    const allChecked = () => all(root, 'input[type="checkbox"]:checked').filter(node => node.closest('tr, [role="row]')?.querySelector('td, [role="cell"], [role="gridcell"]'));
    if (!section.single && allChecked().length) throw new Error('商品列表已有勾选，请取消后再运行。');
    const selectedByUs = [];
    let clicked = false;
    try {
      if (!section.single) {
        for (const row of rows) {
          const node = checkbox(row);
          if (!enabled(node) || node.checked || state.stop) return false;
          node.click();
          selectedByUs.push(node);
        }
      }
      const target = await waitFor(() => section.single ? rowButton(rows[0]) :
        (selectedByUs.every(node => node.isConnected && node.checked) && allChecked().length === ids.length
          ? buttons(root, '批量提报')[0] : null), 3000);
      if (state.stop) return false;
      if (!target || drawer() !== root || !rows.every(row => root.contains(row)) || !rows.every(row => eligible(root, section.single).includes(row))) {
        throw new Error('提报前页面或商品状态发生变化。');
      }
      const baseline = new Map([...signal(selectors.success), ...signal(selectors.error)]);
      const baselineDialogs = new Set(all(document, selectors.dialog));
      verifyCaptcha();
      clicked = true;
      target.click();
      const readReceipt = () => {
        const current = drawer();
        if (current) {
          const seen = new Map(rowList(current).map(row => [productId(row), text(row)]));
          if (ids.every(id => !rejected.test(seen.get(id) || '') && confirmed.test(seen.get(id) || ''))) return 'rows';
        }
        const errors = signal(selectors.error).find(([node, message]) => message && baseline.get(node) !== message);
        if (errors) return { error: errors[1] };
        const successDialog = all(document, selectors.dialog).find(node => !baselineDialogs.has(node) &&
          /趋势提报成功|趋势商机提报成功|报名成功/.test(text(node)));
        if (successDialog) return { successDialog };
        const success = signal(selectors.success).find(([node, message]) => baseline.get(node) !== message &&
          /提报成功|报名成功/.test(message));
        return success ? 'toast' : null;
      };
      let result = await waitFor(readReceipt, 10000, true);
      if (!result && !state.stop) {
        log('本批回执未确认，继续核对已提交商品');
        result = await waitFor(readReceipt, 20000, true);
      }
      while (!result && !state.stop) {
        state.paused = true;
        state.status = '提报结果待核实，点击「继续」复查这一批。';
        log(title + ' · 等待复查 · ' + ids.join('、'));
        while (state.paused && !state.stop) await delay(100);
        if (!state.stop) result = await waitFor(readReceipt, 10000, true);
      }
      if (!result || result.error) {
        if (result?.error) log('平台提示：' + result.error);
        pending(ids, title);
      }
      log('千牛已受理 ' + ids.length + ' 件 · ' + title + ' · ' + ids.join('、'));
      if (result.successDialog) await closeDrawer(result.successDialog);
      return true;
    } catch (error) {
      if (clicked && !state.unresolved && !String(error.message).includes('抽屉')) pending(ids, title);
      throw error;
    } finally {
      if (!clicked) {
        for (const node of selectedByUs) if (node.isConnected && node.checked && enabled(node)) node.click();
      }
    }
  }

  async function nextPage(root, readSignature) {
    const candidates = all(root, selectors.next)
      .filter(node => (root !== document || !node.closest(selectors.dialog)) && enabled(node));
    const controls = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (controls.length > 1) throw new Error('页面出现多个下一页按钮，无法确定分页范围。');
    if (!controls.length) return false;
    const previous = readSignature();
    controls[0].click();
    if (!await waitFor(() => { const value = readSignature(); return value && value !== previous; })) {
      if (state.stop) return false;
      throw new Error('下一页未刷新，已停止以避免重复处理。');
    }
    return true;
  }

  function marketPageSignature() {
    const titles = all(document, '[class*="opportunityTitle"], [data-opportunity-title]')
      .filter(node => !node.closest(selectors.dialog)).map(text);
    const pagination = all(document, '.next-pagination .next-current, [aria-current="page"]')
      .filter(node => !node.closest(selectors.dialog)).map(text);
    return [...pagination, ...titles].join('|');
  }
  function marketDrawerStatus(root) {
    const loading = all(root, '[aria-busy="true"], .next-loading-indicator, .next-loading-tip');
    if (loading.length) return null;
    if (rowList(root).some(row => checkbox(row) || productId(row))) return 'rows';
    const placeholders = all(root, 'tbody td, .next-table-empty, .next-table-empty-content, [data-empty]');
    return placeholders.some(node => emptySearchResult.test(text(node))) ? 'empty' : null;
  }

  async function waitForMarketDrawer(root) {
    let emptySince = 0;
    return waitFor(() => {
      const status = marketDrawerStatus(root);
      if (status !== 'empty') {
        emptySince = 0;
        return status;
      }
      emptySince ||= Date.now();
      return Date.now() - emptySince >= 600 ? status : null;
    }, 10000);
  }

  async function processCard(card, section, scan, totals) {
    card.button.click();
    const root = await waitFor(drawer);
    if (state.stop) return;
    if (!root) throw new Error('未打开「' + card.title + '」的商品抽屉。');
    const empty = () => emptySearchResult.test(text(root));
    const firstStatus = totals ? await waitForMarketDrawer(root) :
      await waitFor(() => rowList(root).length || empty());
    if (!firstStatus) {
      if (state.stop) { await closeDrawer(root); return; }
      if (!totals) throw new Error('抽屉中的商品列表未就绪。');
      totals.unreadable++;
      log(card.title + ' · 商品表未就绪，已跳过此商机');
      await closeDrawer(root);
      return;
    }
    if (totals ? firstStatus === 'empty' : empty()) {
      if (totals) totals.empty++;
      log(card.title + ' · 没有可提报商品，已跳过');
      await closeDrawer(root);
      return;
    }
    let fallbackKeyword = null;
    if (section.search) {
      await search(root, card.title);
      if (!state.stop && empty() && !/没有相关类目的商品/.test(text(root))) {
        fallbackKeyword = apparelKeyword(card.title);
        if (fallbackKeyword) {
          log(card.title + ' · 完整标题无结果，用「' + fallbackKeyword + '」补搜一次');
          try {
            await search(root, fallbackKeyword);
          } catch (error) {
            if (!empty() || error.message !== '无法确认相似款搜索结果已刷新。') throw error;
          }
        }
      }
      if (empty()) {
        log(card.title + ' · 关键词搜索无可提报商品，已跳过');
        await closeDrawer(root);
        return;
      }
    }
    const visited = new Set();
    let submitted = false;
    let unidentified = false;
    do {
      const pageStatus = totals ? await waitForMarketDrawer(root) :
        await waitFor(() => rowList(root).length || empty());
      if (!pageStatus) {
        if (state.stop) break;
        if (!totals) throw new Error('抽屉中的商品列表未就绪。');
        totals.unreadable++;
        log(card.title + ' · 分页商品表未就绪，已结束此商机');
        unidentified = true;
        break;
      }
      let loggedUnidentified = false;
      while (visible(root) && !state.stop) {
        verifyCaptcha();
        const eligibleRows = eligible(root, section.single);
        const rows = fallbackKeyword ? eligibleRows.filter(row => text(row).toLowerCase().includes(fallbackKeyword.toLowerCase())) : eligibleRows;
        const identified = rows.map(row => ({ row, id: productId(row) }));
        const counts = new Map();
        for (const { id } of identified) {
          if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
        const candidates = identified.filter(({ id }) => counts.get(id) === 1).map(({ row }) => row);
        if (!loggedUnidentified && candidates.length !== rows.length) {
          log(card.title + ' · 跳过 ' + (rows.length - candidates.length) + ' 条无法唯一识别商品 ID 的行');
          loggedUnidentified = true;
          unidentified = true;
          if (totals) totals.unidentifiedRows += rows.length - candidates.length;
        }
        if (scan) { log(card.title + ' · 本页可提报 ' + candidates.length + ' 件'); break; }
        const remaining = candidates.filter(row => !visited.has(productId(row)));
        if (!remaining.length) break;
        const count = Number(text(root).match(/单次最多(?:可)?提报\s*(\d+)\s*件/)?.[1]);
        const batch = remaining.slice(0, section.single ? 1 : Math.min(50, count || 50));
        if (!await submit(root, batch, section, card.title)) break;
        submitted = true;
        if (totals) totals.accepted += batch.length;
        for (const row of batch) visited.add(productId(row));
      }
    } while (!state.stop && !(section.search && submitted) && visible(root) && await nextPage(root, () => rowList(root).map(row => productId(row) || text(row)).join('|')));
    if (totals && !submitted && !unidentified && !state.stop) {
      totals.empty++;
      log(card.title + ' · 商品表中没有可勾选商品，已跳过');
    }
    if (!state.unresolved) await closeDrawer(root);
  }

  function summary(totals) {
    return '已检查商机 ' + totals.cards + ' 个，平台已受理 ' + totals.accepted +
      ' 件，空商机 ' + totals.empty + ' 个，表格识别失败 ' + totals.unreadable +
      ' 个，无法确认商品 ID ' + totals.unidentifiedRows + ' 行。';
  }

  async function run(keys, scan, totals) {
    const openDrawer = drawer();
    if (openDrawer) {
      const isUnselectedBatch = buttons(openDrawer, '批量提报').length ||
        all(openDrawer, 'button').some(node => text(node) === '批量提报');
      if (!isUnselectedBatch || all(openDrawer, 'input[type="checkbox"]:checked').length) {
        throw new Error('请先关闭当前商品抽屉，再启动新任务。');
      }
      await closeDrawer(openDrawer);
    }
    if (!tab('市场趋势') && !tab('平台缺货') && !tab('全网爆款')) throw new Error('当前页面没有识别到千牛商机发现。');
    let cardCount = 0;
    for (const key of keys) {
      if (state.stop) break;
      const section = sections[key];
      log('进入「' + section.name + '」');
      if (!tab(section.tabs[0])) {
        log('当前店铺未显示「' + section.name + '」入口，已跳过');
        continue;
      }
      await activate(section.tabs[0]);
      if (section.tabs[1] && !await waitFor(() => tab(section.tabs[1]), 1800)) {
        if (!state.stop) log('当前店铺未显示「' + section.name + '」入口');
        continue;
      }
      if (section.tabs[1]) await activate(section.tabs[1]);
      const visited = new Set();
      do {
        const cards = await waitFor(() => {
          const map = opportunities();
          return map.size ? map : null;
        }, 3500);
        if (!cards) {
          if (state.stop) break;
          log('当前页没有识别到可提报的商机卡片');
          if (totals && marketPageSignature()) continue;
          break;
        }
        for (const cardKey of cards.keys()) {
          if (state.stop) break;
          if (visited.has(cardKey)) continue;
          const card = opportunities().get(cardKey);
          if (!card) continue;
          visited.add(cardKey);
          cardCount++;
          if (totals) totals.cards++;
          await processCard(card, section, scan, totals);
        }
      } while (!state.stop && await nextPage(document, totals ? marketPageSignature : () => [...opportunities().keys()].join('\n')));
    }
    if (totals) {
      state.status = (state.stop ? '全量提报已停止。' : '市场趋势 · 全量提报结束。') + summary(totals);
      log(state.status);
      return;
    }
    state.status = state.stop ? '已停止' : (scan ? '扫描完成' : '提报流程结束') + '，处理商机 ' + cardCount + ' 个。';
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.source !== 'trend-assistant' || sender.id !== chrome.runtime.id) return;
    if (message.command === 'ready') {
      respond(Boolean(tab('市场趋势') || tab('平台缺货') || tab('全网爆款')));
      return;
    }
    if (message.command === 'resume' && state.running && state.paused) {
      state.paused = false;
      state.status = '正在复查提报结果…';
    }
    if (message.command === 'stop' && state.running) {
      state.stop = true;
      state.status = '正在停止，等待已提交批次回执…';
    }
    if ((['scan', 'start', 'startDefault', 'startMarketAll'].includes(message.command)) && !state.running) {
      const defaultKeys = activeTab('平台缺货')
        ? (activeTab('同款稀缺') ? ['same'] : ['similar', 'same'])
        : Object.keys(sections);
      const fullMarket = message.command === 'startMarketAll';
      const requested = fullMarket ? ['market'] : message.command === 'startDefault' ? defaultKeys : message.sections;
      const keys = [...new Set(Array.isArray(requested) ? requested : [])]
        .filter(key => Object.hasOwn(sections, key));
      if (keys.length && (!state.unresolved || message.command === 'scan')) {
        state.running = true;
        state.stop = false;
        state.log = [];
        const totals = fullMarket ? { cards: 0, accepted: 0, empty: 0, unreadable: 0, unidentifiedRows: 0 } : null;
        state.status = fullMarket ? '正在运行市场趋势 · 全量提报…' : message.command === 'scan' ? '正在扫描…' : '正在提报…';
        run(keys, message.command === 'scan', totals).catch(error => {
          state.status = error.message;
          log(error.message);
          if (totals) log(summary(totals));
        }).finally(() => { state.running = false; state.paused = false; });
      }
    }
    respond({ ...state });
  });
})();