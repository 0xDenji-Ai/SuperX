(function(root,factory) {
  'use strict';
  const api = factory(typeof module==='object'&&module.exports?require('./feed-core.js'):root.XGrokCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SuperXHistoryUI = api;
    if (root.document && root.chrome?.runtime) api.create({environment:root}).start();
  }
})(globalThis,function(Core) {
  'use strict';
  const TTL = 24 * 60 * 60 * 1000;
  const PAGE_SIZE = 100;
  const searchIndexes = new WeakMap(),displaySignatures = new WeakMap();
  function safePostUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || !/^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/) || url.pathname.match(/^\/i\/web\/status\/(\d+)(?:\/|$)/);
      if (!match) return null;
      return match.length === 2 ? `https://x.com/i/web/status/${match[1]}` : `https://x.com/${match[1].toLowerCase()}/status/${match[2]}`;
    } catch { return null; }
  }
  function safeSourceUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function boundedText(value,limit) { return typeof value === 'string' ? value.slice(0,limit) : ''; }
  function safeUsage(value) {
    if (!value || typeof value !== 'object') return undefined;
    const usage = {};
    for (const key of ['total_tokens','input_tokens','output_tokens']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) usage[key] = value[key];
    return Object.keys(usage).length ? usage : undefined;
  }
  function searchIndex(entry) {
    if (!searchIndexes.has(entry)) searchIndexes.set(entry,[entry.text,entry.author,entry.url,entry.analysis?.text,...(entry.comments || [])].join('\n').toLocaleLowerCase());
    return searchIndexes.get(entry);
  }
  function displaySignature(entry) {
    if (!displaySignatures.has(entry)) {
      const analysis = entry.analysis;
      displaySignatures.set(entry,JSON.stringify([entry.author,entry.url,entry.text,entry.comments,
        analysis && [analysis.text,analysis.sources,analysis.verificationStatus,analysis.verificationStart,analysis.model,analysis.usageComplete,
          analysis.usage?.total_tokens,analysis.usage?.input_tokens,analysis.usage?.output_tokens]]));
    }
    return displaySignatures.get(entry);
  }
  function filterEntries(entries,query,now,ttl = TTL) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return entries.filter(entry => Number.isFinite(entry.lastViewedAt) && entry.lastViewedAt > now - ttl && entry.lastViewedAt <= now + 60000)
      .filter(entry => !needle || searchIndex(entry).includes(needle))
      .sort((a,b) => b.lastViewedAt - a.lastViewedAt);
  }
  function normalizeEntries(entries) {
    const seen = new Set();
    return entries.slice(0,1000).flatMap(value => {
      const id = boundedText(value?.id,128),url = safePostUrl(value?.url);
      if (!id || !url || seen.has(id) || !Number.isFinite(value?.lastViewedAt)) return [];
      seen.add(id);
      const analysis = value.analysis && typeof value.analysis === 'object' ? {
        text:boundedText(value.analysis.text,30000),
        sources:Array.isArray(value.analysis.sources) ? value.analysis.sources.slice(0,30).flatMap(source => {
          const sourceUrl = safeSourceUrl(source?.url);
          return sourceUrl ? [{url:sourceUrl,title:boundedText(source.title,300)}] : [];
        }) : [],
        verificationStatus:boundedText(value.analysis.verificationStatus,40),
        verificationStart:Number.isSafeInteger(value.analysis.verificationStart) ? value.analysis.verificationStart : undefined,
        model:boundedText(value.analysis.model,160),
        usage:safeUsage(value.analysis.usage),
        usageComplete:value.analysis.usageComplete === true,
      } : null;
      if(analysis) {
        const output=Core.readerOutput(analysis.text,{final:true});
        analysis.text=output.text;
        if(output.kind!=='content') {
          analysis.sources=[];analysis.verificationStart=undefined;
          analysis.verificationStatus='incomplete';
        }
      }
      return [{id,url,author:boundedText(value.author,300),text:boundedText(value.text,12000),lastViewedAt:value.lastViewedAt,analysis,
        comments:Array.isArray(value.comments) ? value.comments.slice(0,3).map(comment => boundedText(comment,2000)).filter(Boolean) : []}];
    });
  }
  function create({environment = globalThis,document = environment.document,chrome = environment.chrome,core = environment.XGrokCore,ui = environment.GrokFirstUI,markdown = environment.GrokFirstMarkdown,now = () => Date.now()} = {}) {
    const $ = id => document.getElementById(id);
    let entries = [],enabled = true,ttl = TTL,loaded = false,loading = false,busy = false,requestRevision = 0,localeRevision = 0,settingsRevision = 0;
    let settings = core.normalizeSettings(core.DEFAULT_SETTINGS),automaticLanguage = ui.browserLanguage(environment),language = automaticLanguage;
    let status = null,expiryTimer = null,notificationTimer = null,refreshQueued = false,visibleLimit = PAGE_SIZE,listRenderPending = false;
    const expanded = new Set(),rows = new Map(),timeFormatters = new Map(),numberFormatters = new Map();
    const t = (key,vars) => ui.t(key,language,vars);
    function element(tag,className,text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
    function link(url,text) { const node = element('a','',text); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }
    function setStatus(key,error = false) { status = key ? {key,error} : null; }
    function setText(node,text) {if (node.textContent !== text) node.textContent = text;}
    function formatTime(value) {
      try {if (!timeFormatters.has(language)) timeFormatters.set(language,new Intl.DateTimeFormat(language,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));return timeFormatters.get(language).format(new Date(value));} catch {return t('history.invalidDate');}
    }
    function totalTokens(value) {
      if (Number.isSafeInteger(value?.total_tokens) && value.total_tokens >= 0) return value.total_tokens;
      if (Number.isSafeInteger(value?.input_tokens) && value.input_tokens >= 0 && Number.isSafeInteger(value?.output_tokens) && value.output_tokens >= 0 && Number.isSafeInteger(value.input_tokens + value.output_tokens)) return value.input_tokens + value.output_tokens;
      return null;
    }
    function number(value) {try {if (!numberFormatters.has(language)) numberFormatters.set(language,new Intl.NumberFormat(language));return numberFormatters.get(language).format(value);} catch {return String(value);}}
    function renderAnswer(target,entry) {
      target.replaceChildren();
      const analysis = entry.analysis;
      const labels = {entry,copyButtons:[]};
      if (analysis?.text) {
        const metadata = element('p','answer-meta');
        const tokens = totalTokens(analysis.usage);
        if (tokens !== null) {labels.tokens = element('span','',t('history.tokens',{count:number(tokens) + (analysis.usageComplete ? '' : '+')}));metadata.append(labels.tokens);}
        if (analysis.model) {labels.model = element('span','',t('history.model',{model:analysis.model}));metadata.append(labels.model);}
        if (metadata.childNodes.length) target.append(metadata);
        if (['incomplete','failed'].includes(analysis.verificationStatus)) {labels.warning = element('p','answer-warning',t('history.previousAnswer'));target.append(labels.warning);}
        const boundary = analysis.verificationStart;
        const explanation = element('div','answer-markdown');
        if (Number.isInteger(boundary) && boundary > 0 && boundary < analysis.text.length) {
          markdown.render(explanation,analysis.text.slice(0,boundary));target.append(explanation);
          const separator = element('hr','fact-check-divider');target.append(separator);
          const factCheck = element('div','answer-markdown');markdown.render(factCheck,analysis.text.slice(boundary));target.append(factCheck);
        } else { markdown.render(explanation,analysis.text);target.append(explanation); }
        const unused = analysis.sources.filter(source => !analysis.text.includes(source.url));
        if (unused.length) {
          const sources = element('div','answer-sources');
          for (const source of unused) sources.append(link(source.url,source.title && !/^\d+$/.test(source.title.trim()) ? source.title : new URL(source.url).hostname));
          target.append(sources);
        }
      }
      if (entry.comments.length) {
        labels.commentsHeading = element('h3','comments-heading',t('history.comments'));target.append(labels.commentsHeading);
        for (const comment of entry.comments) {
          const button = element('button','comment-copy',comment);button.type = 'button';button.title = t('history.copy');
          button.addEventListener('click',async () => {
            try { if (!environment.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable'); await environment.navigator.clipboard.writeText(comment);setStatus('history.copied'); }
            catch { setStatus('history.copyError',true); }
            renderStatus();
          });target.append(button);labels.copyButtons.push(button);
        }
      }
      return labels;
    }
    function buildRow(entry) {
      const article = element('article','history-entry');article.dataset.entryId = entry.id;
      const row = {node:article,signature:displaySignature(entry),entry};
      const header = element('div','entry-header');
      const author = element('span','entry-author',entry.author || new URL(entry.url).pathname.split('/')[1]);header.append(author);
      const time = element('time','entry-time');row.time = time;header.append(time);article.append(header);
      if (entry.text) article.append(element('p','entry-text',entry.text));
      const actions = element('div','entry-actions');row.open = link(entry.url,t('history.open'));actions.append(row.open);
      const remove = element('button','text-button',t('history.delete'));remove.type = 'button';remove.disabled = busy;remove.dataset.action = 'delete';
      row.remove = remove;
      remove.setAttribute('aria-label',t('history.delete') + ' · ' + (entry.author || entry.id));
      remove.addEventListener('click',() => mutate({type:'DELETE_HISTORY',id:entry.id},'history.deleted','history.deleteError'));actions.append(remove);article.append(actions);
      if (entry.analysis?.text || entry.comments.length) {
        const details = element('details','answer-details'),summary = element('summary','',t(expanded.has(entry.id) ? 'history.hideAnswer' : 'history.showAnswer')),body = element('div','answer-body');
        row.details = details;row.summary = summary;row.body = body;
        details.open = expanded.has(entry.id);details.append(summary,body);if (details.open) row.answerLabels = renderAnswer(body,entry);
        details.addEventListener('toggle',() => {
          // A toggle is queued by the browser, including when restoring an
          // open details element. Ignore a removed row and do not rebuild an
          // already rendered answer: selection and copy focus stay intact.
          if (rows.get(entry.id) !== row) return;
          if (details.open) { expanded.add(entry.id);if (!row.answerLabels) row.answerLabels = renderAnswer(body,entry); }
          else { expanded.delete(entry.id);body.replaceChildren();row.answerLabels = null; }
          summary.textContent = t(details.open ? 'history.hideAnswer' : 'history.showAnswer');
        });article.append(details);
      } else {row.noAnalysis = element('p','help',t(['incomplete','failed'].includes(entry.analysis?.verificationStatus)?'status.incomplete':'history.noAnalysis'));article.append(row.noAnalysis);}
      return row;
    }
    function updateRow(row,entry) {
      row.entry = entry;
      setText(row.time,formatTime(entry.lastViewedAt));row.time.dateTime = new Date(entry.lastViewedAt).toISOString();row.time.title = t('history.lastViewed');
      setText(row.open,t('history.open'));setText(row.remove,t('history.delete'));row.remove.disabled = busy;
      row.remove.setAttribute('aria-label',t('history.delete') + ' · ' + (entry.author || entry.id));
      if (row.noAnalysis) setText(row.noAnalysis,t(['incomplete','failed'].includes(entry.analysis?.verificationStatus)?'status.incomplete':'history.noAnalysis'));
      if (row.summary) setText(row.summary,t(row.details.open ? 'history.hideAnswer' : 'history.showAnswer'));
      const labels = row.answerLabels,analysis = entry.analysis;
      if (labels?.tokens) setText(labels.tokens,t('history.tokens',{count:number(totalTokens(analysis.usage)) + (analysis.usageComplete ? '' : '+')}));
      if (labels?.model) setText(labels.model,t('history.model',{model:analysis.model}));
      if (labels?.warning) setText(labels.warning,t('history.previousAnswer'));
      if (labels?.commentsHeading) setText(labels.commentsHeading,t('history.comments'));
      for (const button of labels?.copyButtons || []) button.title = t('history.copy');
    }
    function listHasSelection() {
      const selection = environment.getSelection?.();
      return Boolean(selection && !selection.isCollapsed && ( $('history-list').contains?.(selection.anchorNode) || $('history-list').contains?.(selection.focusNode)));
    }
    function renderList(shown,force) {
      // Incoming completed answers may replace content. Let readers finish
      // selecting/copying their current text before applying passive updates.
      if (!force && listHasSelection()) {listRenderPending = true;return;}
      listRenderPending = false;
      const liveIds = new Set(filterEntries(entries,'',now(),ttl).map(entry => entry.id));
      for (const [id] of rows) if (!liveIds.has(id)) {rows.delete(id);expanded.delete(id);}
      const nodes = shown.slice(0,visibleLimit).map(entry => {
        let row = rows.get(entry.id);
        if (!row || row.signature !== displaySignature(entry)) {row = buildRow(entry);rows.set(entry.id,row);}
        updateRow(row,entry);return row.node;
      });
      const list = $('history-list'),wanted = new Set(nodes);
      for (let index = 0;index < nodes.length;index++) if (list.childNodes[index] !== nodes[index]) list.insertBefore(nodes[index],list.childNodes[index] || null);
      for (const child of [...list.childNodes]) if (!wanted.has(child)) list.removeChild(child);
    }
    function renderStatus() {
      $('history-status').textContent = status ? t(status.key) : loading && !loaded ? t('history.loading') : '';
      $('history-status').dataset.state = status?.error ? 'error' : 'success';
    }
    function render({forceList = false} = {}) {
      ui.apply(document,language);document.title = 'SuperX · ' + t('history.title');renderStatus();
      $('history-enabled').checked = enabled;$('history-enabled').disabled = busy || !loaded;
      $('refresh-history').disabled = busy || loading;
      const available = filterEntries(entries,'',now(),ttl),query = $('history-search').value,shown = query.trim() ? filterEntries(entries,query,now(),ttl) : available;
      $('clear-history').disabled = busy || !loaded || !available.length;
      $('confirm-clear').disabled = busy;$('cancel-clear').disabled = busy;
      $('history-list').setAttribute('aria-busy',String(loading || busy));
      $('history-count').textContent = loaded ? t('history.count',{count:number(shown.length)}) : '';
      $('history-empty').hidden = !loaded || Boolean(shown.length);
      $('empty-title').textContent = t(available.length ? 'history.noMatches' : 'history.empty');
      $('empty-help').textContent = available.length ? '' : t('history.emptyHelp');
      $('history-more').hidden = shown.length <= visibleLimit;$('more-history').disabled = busy || loading;
      renderList(shown,forceList);
      scheduleExpiry();
    }
    function scheduleExpiry() {
      if (expiryTimer !== null) environment.clearTimeout?.(expiryTimer);
      if (!environment.setTimeout || !loaded) return;
      const soonest = entries.filter(entry => entry.lastViewedAt > now()-ttl).reduce((value,entry) => Math.min(value,entry.lastViewedAt+ttl),Infinity);
      if (Number.isFinite(soonest)) expiryTimer = environment.setTimeout(() => {expiryTimer = null;if (soonest <= now()) render({forceList:true});else scheduleExpiry();},Math.max(1,Math.min(soonest-now()+1,60000)));
    }
    function accept(result) {
      if (!result?.ok || !Array.isArray(result.entries) || typeof result.enabled !== 'boolean') throw new Error('History response unavailable');
      entries = normalizeEntries(result.entries);enabled = result.enabled;
      ttl = Number.isFinite(result.limits?.ttlMs) && result.limits.ttlMs > 0 ? Math.min(result.limits.ttlMs,TTL) : TTL;
      loaded = true;
    }
    async function refresh({preserveStatus = false,forceList = true} = {}) {
      if (busy) { refreshQueued = true;return; }
      const revision = ++requestRevision;loading = true;if (!preserveStatus) setStatus(null);render();
      try { const result = await chrome.runtime.sendMessage({type:'GET_HISTORY'});if (revision !== requestRevision) return;accept(result); }
      catch { if (revision === requestRevision) setStatus('history.error',true); }
      finally { if (revision === requestRevision) { loading = false;render({forceList}); } }
    }
    async function mutate(message,success,error) {
      if (busy || !loaded) return;
      ++requestRevision;loading = false;busy = true;setStatus(null);render();
      try {
        const result = await chrome.runtime.sendMessage(message);accept(result);setStatus(success);
        if (message.type === 'CLEAR_HISTORY') { $('clear-confirmation').hidden = true;expanded.clear();$('history-search').focus(); }
        if (message.type === 'DELETE_HISTORY') { expanded.delete(message.id);$('history-search').focus(); }
      } catch { setStatus(error,true); }
      finally {
        busy = false;render({forceList:true});
        if (refreshQueued) { refreshQueued = false;await refresh({preserveStatus:true,forceList:false}); }
      }
    }
    function historyChanged() {
      if (busy) { refreshQueued = true;return; }
      if (notificationTimer !== null) environment.clearTimeout?.(notificationTimer);
      if (!environment.setTimeout) { refresh({preserveStatus:true,forceList:false});return; }
      notificationTimer = environment.setTimeout(() => { notificationTimer = null;refresh({preserveStatus:true,forceList:false}); },250);
    }
    async function start() {
      $('history-search').addEventListener('input',() => {visibleLimit = PAGE_SIZE;render({forceList:true});});
      $('more-history').addEventListener('click',() => {visibleLimit += PAGE_SIZE;render({forceList:true});});
      $('refresh-history').addEventListener('click',refresh);
      $('history-enabled').addEventListener('change',() => mutate({type:'SET_HISTORY_ENABLED',enabled:$('history-enabled').checked},'history.saved','history.recordingError'));
      $('clear-history').addEventListener('click',() => { if (busy || !loaded || !entries.length) return;$('clear-confirmation').hidden = false;$('confirm-clear').focus(); });
      $('cancel-clear').addEventListener('click',() => { if (busy) return;$('clear-confirmation').hidden = true;$('clear-history').focus(); });
      $('confirm-clear').addEventListener('click',() => mutate({type:'CLEAR_HISTORY'},'history.cleared','history.clearError'));
      document.addEventListener?.('keydown',event => { if (event.key === 'Escape' && !$('clear-confirmation').hidden && !busy) { $('clear-confirmation').hidden = true;$('clear-history').focus(); } });
      document.addEventListener?.('selectionchange',() => {if (listRenderPending && !listHasSelection()) render();});
      chrome.runtime.onMessage?.addListener(message => {
        if (message?.type === 'UI_LANGUAGE_CHANGED') { localeRevision++;automaticLanguage = ui.normalizeLanguage(message.language);language = ui.resolveLanguage(settings.interfaceLanguage,automaticLanguage);render(); }
        if (message?.type === 'HISTORY_CHANGED') historyChanged();
      });
      chrome.storage?.onChanged?.addListener((changes,area) => {
        if (area !== 'local') return;
        if (changes.settings) { settingsRevision++;settings = core.normalizeSettings(changes.settings.newValue); }
        if (changes.uiLanguage) { localeRevision++;automaticLanguage = ui.normalizeLanguage(changes.uiLanguage.newValue); }
        if (changes.settings || changes.uiLanguage) { language = ui.resolveLanguage(settings.interfaceLanguage,automaticLanguage);render(); }
        // The store key is intentionally not interpreted here; the worker
        // owns pruning and redaction of persisted history data.
        if (changes.superxHistory || changes.superxHistoryEnabled) historyChanged();
      });
      environment.addEventListener?.('unload',() => { if (expiryTimer !== null) environment.clearTimeout?.(expiryTimer);if (notificationTimer !== null) environment.clearTimeout?.(notificationTimer); });
      render();const revision = localeRevision,configRevision = settingsRevision;
      await Promise.all([
        refresh(),
        (async () => {
          try {
            const [local,locale,config] = await Promise.all([
              chrome.storage?.local?.get?.(['uiLanguage']) || {},
              chrome.runtime.sendMessage({type:'GET_UI_LANGUAGE'}).catch(() => null),
              chrome.runtime.sendMessage({type:'GET_CONFIG'}).catch(() => null),
            ]);
            if (config?.ok && settingsRevision === configRevision) settings = core.normalizeSettings(config.settings);
            if (localeRevision === revision) automaticLanguage = ui.normalizeLanguage(locale?.language || local.uiLanguage || automaticLanguage);
            language = ui.resolveLanguage(settings.interfaceLanguage,automaticLanguage);render();
          } catch { /* History remains usable when the locale lookup fails. */ }
        })(),
      ]);
    }
    return Object.freeze({start,refresh,render});
  }
  return Object.freeze({create,safePostUrl,safeSourceUrl,filterEntries,normalizeEntries});
});
