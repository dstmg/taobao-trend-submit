const trendUrl = 'https://myseller.taobao.com/home.htm/trend-product-operation/home';
const launchingTabs = new Set();

function isTrendPage(url) {
  return typeof url === 'string' && url.startsWith('https://myseller.taobao.com/home.htm/trend-product-operation/');
}

async function message(tabId, command) {
  return chrome.tabs.sendMessage(tabId, { source: 'trend-assistant', command });
}

async function start(tabId, currentUrl, mode) {
  if (launchingTabs.has(tabId)) return;
  launchingTabs.add(tabId);
  let dispatched = false;
  try {
    await chrome.action.setBadgeText({ tabId, text: '…' });
    if (!isTrendPage(currentUrl)) await chrome.tabs.update(tabId, { url: trendUrl });
    const expires = Date.now() + 22000;
    while (Date.now() < expires) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        const state = await message(tabId, 'status').catch(() => null);
        if (state && await message(tabId, 'ready').catch(() => false)) {
          dispatched = true;
          await message(tabId, mode === 'marketAll' ? 'startMarketAll' : 'startDefault');
          await chrome.action.setBadgeText({ tabId, text: "" });
          await chrome.action.setTitle({ tabId, title: "千牛趋势提报助手" });
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('未识别商机发现页面，请检查千牛登录状态后重试。');
  } catch (error) {
    await chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
    const detail = dispatched ? '启动回执未收到，请重新打开扩展核对任务。' : error.message;
    await chrome.action.setTitle({ tabId, title: detail }).catch(() => {});
  } finally {
    launchingTabs.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.source !== 'trend-launcher' ||
      message.command !== 'launch' || !Number.isInteger(message.tabId)) return;
  respond({ accepted: true });
  void start(message.tabId, message.currentUrl, message.mode);
});