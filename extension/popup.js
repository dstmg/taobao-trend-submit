const start = document.getElementById('start');
const marketAll = document.getElementById('market-all');
const resume = document.getElementById('resume');
const stop = document.getElementById('stop');
const status = document.getElementById('status');
const log = document.getElementById('log');
let tabId;
let launchPending = false;

async function send(command) {
  return chrome.tabs.sendMessage(tabId, { source: 'trend-assistant', command });
}

async function refresh() {
  const state = await send('status').catch(() => null);
  const badge = await chrome.action.getBadgeText({ tabId });
  if (state?.running || badge !== '…') launchPending = false;
  stop.hidden = !state?.running;
  resume.hidden = !state?.paused;
  start.hidden = marketAll.hidden = Boolean(state?.running);
  start.disabled = marketAll.disabled = Boolean(launchPending || badge === '…' || state?.running || state?.unresolved);
  const message = badge === '!' ? await chrome.action.getTitle({ tabId }) :
    (launchPending || badge === '…') && !state?.running ? '正在打开千牛商机发现…' :
    state?.status === '就绪' || !state ? '点击后自动打开千牛商机发现。' : state.status;
  if (status.textContent !== message) status.textContent = message;
  const entries = state?.log.join('\n') || '';
  if (log.textContent !== entries) {
    log.textContent = entries;
    log.scrollTop = log.scrollHeight;
  }
}

async function launch(mode) {
  if (launchPending) return;
  launchPending = true;
  start.disabled = marketAll.disabled = true;
  status.textContent = '正在启动趋势提报…';
  try {
    const currentTab = await chrome.tabs.get(tabId);
    const response = await chrome.runtime.sendMessage({
      source: 'trend-launcher', command: 'launch', tabId, currentUrl: currentTab.url, mode
    });
    if (!response?.accepted) throw new Error('启动请求未送达，请重试。');
  } catch (error) {
    launchPending = false;
    start.disabled = marketAll.disabled = false;
    status.textContent = error.message;
  }
}

start.addEventListener('click', () => launch('default'));
marketAll.addEventListener('click', () => launch('marketAll'));

resume.addEventListener('click', async () => {
  await send('resume').catch(() => {});
  await refresh();
});

stop.addEventListener('click', async () => {
  await send('stop').catch(() => {});
  await refresh();
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('找不到当前标签页。');
    tabId = tab.id;
    await refresh();
    setInterval(() => { void refresh().catch(() => {}); }, 650);
  } catch (error) { status.textContent = error.message; }
})();