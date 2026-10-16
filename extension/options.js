"use strict";

(() => {
  const core = globalThis.XGrokCore;
  const ui = globalThis.GrokFirstUI;
  const $ = id => document.getElementById(id);
  const promptFields = [
    {name:"verify",setting:"verifyPrompt"},
    {name:"comments",setting:"commentsPrompt"},
  ];
  const promptLimit = core.MAX_PROMPT_LENGTH || 12000;
  let currentSettings = core.normalizeSettings(core.DEFAULT_SETTINGS);
  let observedUILanguage = ui.browserLanguage(globalThis);
  let uiLanguage = observedUILanguage;
  let localeRevision = 0;
  let statusMessage = null;
  let keyChanged = false;
  let rememberChanged = false;
  let originalKey = "";
  let security = {keyState:"missing",remember:true,hasSavedKey:false};
  let securityLoaded = false;
  let busy = false;
  let optionsFocusPending = false;
  let lastOptionsFocusNonce;
  let historyReady=false, historyBusy=false,historyStatusKey=null;
  let buildStatus = null, buildChecking = false, buildCheckRevision = 0;
  const advertisedBuildModels = new Set();
  const apiControlIds = ["api-key","remember-key","api-model","api-reasoning-effort","fast-preset","api-concurrency","clear-key"];
  const buildControlIds = ["build-transport","build-model","build-reasoning-effort","check-build","connector-guide"];
  const isBuild = () => $("provider").value === "build";
  function buildStateKey() {
    if (buildChecking) return "build.checking";
    if (!buildStatus) return "build.unknown";
    if (buildStatus.permission === "denied" || buildStatus.errorCode === "BUILD_PERMISSION_REQUIRED") return "build.permission";
    if (buildStatus.ready === true) return "build.ready";
    if (buildStatus.installed === false && buildStatus.connected === true) return "options.buildStep2";
    if (buildStatus.installed === false || ["BUILD_HOST_MISSING","BUILD_NATIVE_MISSING"].includes(buildStatus.errorCode)) return "build.missing";
    if (buildStatus.authenticated === false || ["BUILD_AUTH_REQUIRED","BUILD_LOGIN_REQUIRED"].includes(buildStatus.errorCode)) return "build.login";
    if (["BUILD_VERSION_UNSUPPORTED","BUILD_UNSUPPORTED_VERSION","BUILD_PROTOCOL_UNSUPPORTED"].includes(buildStatus.errorCode)) return "build.unsupported";
    return "build.unavailable";
  }
  function renderBuildStatus() {
    $("build-status").textContent = ui.t(buildStateKey(),uiLanguage);
    $("build-status").dataset.state = buildStatus?.ready === true ? "ready" : "unknown";
    $("check-build").disabled = busy || buildChecking || !isBuild();
    const catalog = buildStatus?.modelCatalog;
    const selected = $("build-model").value;
    const unavailable = Array.isArray(catalog) && !catalog.some(item => (typeof item === "string" ? item : item.id) === selected && item.available !== false);
    $("build-model-status").textContent = unavailable ? ui.t("options.buildModelUnavailable",uiLanguage,{model:selected}) : "";
    $("build-fast-help").textContent = ui.t("options.buildFastHelp",uiLanguage);
    $("build-fast-help").hidden = !/fast/i.test(selected);
  }
  function renderProvider() {
    const build = isBuild();
    $("api-fields").hidden = build;$("build-fields").hidden = !build;
    for (const id of apiControlIds) $(id).disabled = busy || build;
    for (const id of buildControlIds) $(id).disabled = busy || !build;
    $("source-description").textContent = ui.t(build ? "options.buildDescription" : "options.providerAPI",uiLanguage);
    $("save").disabled = busy || (!build && !securityLoaded);
    renderBuildStatus();
  }

  function setHistoryStatus(key) {historyStatusKey=key;$("history-status").textContent=key?ui.t(key,uiLanguage):"";}

  function setStatus(key, state = "success", vars = {}) {
    statusMessage = {key,state,vars};
    $("status").textContent = ui.t(key,uiLanguage,vars);
    $("status").dataset.state = state;
  }
  function setBusy(value) {
    busy = value;
    for (const control of $("settings-form").elements) control.disabled = value;
    $("history-enabled").disabled=value||!historyReady||historyBusy;
    renderSecurity();
    renderProvider();
    if (!value && optionsFocusPending) void consumeOptionsFocus();
  }
  function keyInputClear() {
    $("api-key").value = "";originalKey = "";keyChanged = false;
  }
  function keyNeedsSave() { return keyChanged || rememberChanged; }
  function renderSecurity() {
    const stateKeys = {ready:security.hasSavedKey ? "options.keyReadySaved" : "options.keyReady",migration:"options.keyMigration",missing:"options.keyMissing"};
    $("key-security-state").textContent = ui.t(stateKeys[security.keyState] || stateKeys.missing,uiLanguage);
    $("key-security-state").dataset.state = security.keyState;
    $("clear-key").hidden = !securityLoaded || security.keyState !== "ready" && !security.hasSavedKey;
    $("save").disabled = busy || (!isBuild() && !securityLoaded);
  }
  async function refreshSecurity(fillKey = false, preserveDraft = false) {
    const result = await send({type:"GET_SECURITY_STATUS"});
    if (!["ready","missing","migration"].includes(result.keyState)
      || typeof result.remember !== "boolean" || typeof result.hasSavedKey !== "boolean") {
      throw new Error(ui.t("errors.noResponse",uiLanguage));
    }
    security = result;securityLoaded = true;
    if (fillKey) {
      const stored = security.keyState === "ready" ? await chrome.storage.session.get("apiKey") : {};
      const latestKey = stored.apiKey || "";
      // A change in another Settings tab updates the untouched input, while an
      // explicitly edited replacement Key remains this tab's unsaved draft.
      if (!preserveDraft || !keyChanged) {
        $("api-key").value = latestKey;
      }
      originalKey = latestKey;
      keyChanged = $("api-key").value.trim() !== originalKey.trim();
    }
    renderSecurity();return result;
  }
  function markDraft() {
    if (busy || (!isBuild() && !securityLoaded)) return;
    const changed = keyChanged || rememberChanged
      || $("provider").value !== currentSettings.provider
      || $("build-transport").value !== currentSettings.buildTransport
      || $("build-model").value !== currentSettings.buildModel
      || $("build-reasoning-effort").value !== currentSettings.buildReasoningEffort
      || $("enabled").checked !== currentSettings.enabled
      || $("explanation-mode").value !== currentSettings.explanationMode
      || $("api-model").value !== currentSettings.apiModel
      || $("api-reasoning-effort").value !== currentSettings.apiReasoningEffort
      || Number($("api-concurrency").value) !== currentSettings.apiConcurrency
      || $("web-search").checked !== currentSettings.webSearch
      || $("x-search").checked !== currentSettings.xSearch
      || $("language").value !== currentSettings.language
      || $("interface-language").value !== currentSettings.interfaceLanguage
      || promptFields.some(field => $(field.name + "-prompt").value !== currentSettings[field.setting]);
    if (changed) setStatus("options.unsavedChanges");
    else if (statusMessage?.key === "options.unsavedChanges") {
      statusMessage = null;$("status").textContent = "";delete $("status").dataset.state;
    }
  }
  async function consumeOptionsFocus() {
    optionsFocusPending = true;
    if (busy || (!isBuild() && !securityLoaded)) return;
    optionsFocusPending = false;
    try {
      const stored = await chrome.storage.session.get("superxOptionsFocus");
      const request = stored.superxOptionsFocus;
      if (!request || !["api-key","unlock-passphrase","build"].includes(request.id)
        || !["string","number"].includes(typeof request.nonce) || request.nonce === lastOptionsFocusNonce) return;
      if (busy) { optionsFocusPending = true;return; }
      lastOptionsFocusNonce = request.nonce;
      // Keep Build navigation on its visible setup controls. Legacy password
      // focus requests still lead to the API Key field in API mode.
      const id = request.id === "build" || isBuild() ? isBuild() ? "check-build" : "provider" : "api-key";
      await chrome.storage.session.remove("superxOptionsFocus");
      $(id).scrollIntoView?.({block:"center",behavior:"instant"});
      $(id).focus({preventScroll:true});
    } catch { /* Opening Settings still works if a focus request cannot be consumed. */ }
  }
  function showExplanationMode() {
    const mode = $("explanation-mode").value || currentSettings.explanationMode || "preset";
    $("analysis-prompts").hidden = mode !== "custom";
    const key = mode === "custom" ? "options.customModeHelp" : "options.presetModeHelp";
    $("explanation-mode-help").textContent = ui.t(key,uiLanguage);
  }
  function populateLanguages(language) {
    const select = $("language");
    select.replaceChildren();
    for (const item of core.LANGUAGES) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.value === "auto" ? ui.t("lang.auto",uiLanguage) : item.label;
      select.append(option);
    }
    if (!core.LANGUAGES.some(item => item.value === language)) {
      const option = document.createElement("option");
      option.value = language;
      option.textContent = ui.t("options.customLanguage",uiLanguage,{language});
      select.append(option);
    }
    select.value = language;
  }
  function applyLanguage(language) {
    observedUILanguage = ui.normalizeLanguage(language);
    renderLanguage();
  }
  function populateInterfaceLanguages(language) {
    const select = $("interface-language");
    select.replaceChildren();
    for (const item of ui.INTERFACE_LANGUAGES) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.value === "auto" ? ui.t("lang.interfaceAuto",uiLanguage) : item.label;
      select.append(option);
    }
    select.value = language;
  }
  function populateModels(model) {
    const select = $("api-model");
    select.replaceChildren();
    for (const item of core.API_MODELS) {
      const option = document.createElement("option");
      option.value = item.value;option.textContent = item.label;
      select.append(option);
    }
    // Keep an already saved alias/custom ID available during upgrades without
    // offering a free-form field or silently changing the user's model.
    if (!core.API_MODELS.some(item => item.value === currentSettings.apiModel)) {
      const option = document.createElement("option");
      option.value = currentSettings.apiModel;
      option.textContent = ui.t("options.savedModel",uiLanguage,{model:currentSettings.apiModel});
      select.append(option);
    }
    select.value = model;
  }
  function populateReasoning(model, effort) {
    const select = $("api-reasoning-effort");
    select.replaceChildren();
    for (const value of core.modelProfile(model)?.efforts || ["auto"]) {
      const option = document.createElement("option");
      option.value = value;option.textContent = ui.t("options.reasoning."+value,uiLanguage);
      select.append(option);
    }
    select.value = core.reasoningEffort(model,effort);
  }
  function buildModelChoices() {
    const models=[...core.API_MODELS];
    for(const entry of buildStatus?.modelCatalog || []){
      const id=typeof entry==="string" ? entry : entry?.id;
      if(typeof id==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id))advertisedBuildModels.add(id);
    }
    for(const id of advertisedBuildModels)if(!models.some(item=>item.value===id))models.push({value:id,label:id});
    if (!models.some(item=>item.value===currentSettings.buildModel)) models.push({value:currentSettings.buildModel,label:ui.t("options.savedModel",uiLanguage,{model:currentSettings.buildModel})});
    return models;
  }
  function populateBuildModels(model) {
    const select = $("build-model");select.replaceChildren();
    for (const item of buildModelChoices()) {
      const option = document.createElement("option");option.value=item.value;option.textContent=item.label;
      const catalog = buildStatus?.modelCatalog;
      option.disabled = Array.isArray(catalog) && !catalog.some(entry => (typeof entry === "string" ? entry : entry.id) === item.value && entry.available !== false);
      select.append(option);
    }
    select.value = model;
  }
  function populateBuildReasoning(model,effort) {
    const select = $("build-reasoning-effort");select.replaceChildren();
    const entry = buildStatus?.modelCatalog?.find(item => typeof item === "object" && item.id === model);
    const supported = core.modelProfile(model)?.efforts || ["low","medium","high","xhigh"];
    const efforts = Array.isArray(entry?.efforts) ? supported.filter(value => entry.efforts.includes(value)) : supported;
    for (const value of efforts) {
      const option=document.createElement("option");option.value=value;option.textContent=ui.t("options.reasoning."+value,uiLanguage);select.append(option);
    }
    select.value=efforts.includes(effort) ? effort : efforts[0] || "";
  }
  function renderLanguage() {
    const interfaceLanguage = $("interface-language").value || currentSettings.interfaceLanguage;
    uiLanguage = ui.resolveLanguage(interfaceLanguage,observedUILanguage);
    ui.apply(document,uiLanguage);
    setHistoryStatus(historyStatusKey);
    document.title = `SuperX · ${ui.t("common.settings",uiLanguage)}`;
    $("extension-version").textContent = ui.t("options.version",uiLanguage,{version:chrome.runtime.getManifest().version});
    populateLanguages($("language").value || currentSettings.language);
    populateInterfaceLanguages(interfaceLanguage);
    const model = $("api-model").value || currentSettings.apiModel;
    const effort = $("api-reasoning-effort").value || currentSettings.apiReasoningEffort;
    populateModels(model);populateReasoning(model,effort);
    const buildModel=$("build-model").value || currentSettings.buildModel;
    const buildEffort=$("build-reasoning-effort").value || currentSettings.buildReasoningEffort;
    populateBuildModels(buildModel);populateBuildReasoning(buildModel,buildEffort);
    showExplanationMode();
    renderSecurity();
    renderProvider();
    if (statusMessage) setStatus(statusMessage.key,statusMessage.state,statusMessage.vars);
  }
  function populate(settings) {
    $("enabled").checked = settings.enabled;
    $("provider").value = settings.provider;
    $("build-transport").value = settings.buildTransport;
    populateBuildModels(settings.buildModel);populateBuildReasoning(settings.buildModel,settings.buildReasoningEffort);
    $("explanation-mode").value = settings.explanationMode === "custom" ? "custom" : "preset";
    populateModels(settings.apiModel);
    populateReasoning(settings.apiModel,settings.apiReasoningEffort);
    $("api-concurrency").value = settings.apiConcurrency;
    $("web-search").checked = settings.webSearch;
    $("x-search").checked = settings.xSearch;
    for (const field of promptFields) $(field.name + "-prompt").value = settings[field.setting];
    populateLanguages(settings.language);
    populateInterfaceLanguages(settings.interfaceLanguage);
    showExplanationMode();
    renderProvider();
  }
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.errorKey ? ui.t(result.errorKey,uiLanguage,result.vars || {}) : result?.error || ui.t("errors.noResponse",uiLanguage));
    return result;
  }
  async function load() {
    setBusy(true);
    const revision = localeRevision;
    try {
      const [local,locale] = await Promise.all([
        chrome.storage.local.get(["settings","uiLanguage"]),
        chrome.runtime.sendMessage({type:"GET_UI_LANGUAGE"}).catch(() => null),
      ]);
      // The worker hydrates remembered Keys before replying. Read its current
      // session mirror only afterwards so a browser restart cannot look empty.
      currentSettings = core.normalizeSettings(local.settings);
      populate(currentSettings);
      try {await refreshSecurity(true);} catch(error) {if(currentSettings.provider!=="build")throw error;}
      $("remember-key").checked = security.remember;
      if (localeRevision === revision) applyLanguage(locale?.language || local.uiLanguage || observedUILanguage);
      else renderLanguage();
    } catch (error) {
      populate(currentSettings);setStatus("errors.load","error",{error:error.message});
    } finally { setBusy(false);await consumeOptionsFocus(); }
  }
  $("explanation-mode").addEventListener("change",() => { showExplanationMode();markDraft(); });
  $("provider").addEventListener("change",() => { renderProvider();markDraft(); });
  $("build-model").addEventListener("change",() => { populateBuildReasoning($("build-model").value,$("build-reasoning-effort").value);renderBuildStatus();markDraft(); });
  $("check-build").addEventListener("click",async () => {
    if (busy || buildChecking || !isBuild()) return;
    const revision=++buildCheckRevision;
    buildChecking=true;renderBuildStatus();
    let permissionGranted=false;
    try {
      // Request directly in this click's user gesture, before any awaited work.
      const permissionRequest=chrome.permissions?.request({permissions:["nativeMessaging"]});
      permissionGranted=await permissionRequest;
      if (revision!==buildCheckRevision) return;
      if(permissionGranted!==true){buildStatus={ready:false,permission:"denied",errorCode:"BUILD_PERMISSION_REQUIRED"};return;}
      const result=await send({type:"GET_BUILD_STATUS",transport:$("build-transport").value});
      if (revision!==buildCheckRevision) return;
      buildStatus=result;
      const model=$("build-model").value,effort=$("build-reasoning-effort").value;
      populateBuildModels(model);populateBuildReasoning(model,effort);
      markDraft();
    } catch {if(revision===buildCheckRevision)buildStatus={ready:false,errorCode:permissionGranted ? "BUILD_STATUS_UNKNOWN" : "BUILD_PERMISSION_REQUIRED"};}
    finally {if(revision===buildCheckRevision){buildChecking=false;renderBuildStatus();}}
  });
  $("connector-guide").addEventListener("click",async () => {
    try {await send({type:"OPEN_CONNECTOR_GUIDE"});}
    catch(error){setStatus("errors.operation","error",{error:error.message});}
  });
  $("build-transport").addEventListener("change",() => {
    buildCheckRevision++;buildChecking=false;buildStatus=null;
    const model=$("build-model").value,effort=$("build-reasoning-effort").value;
    populateBuildModels(model);populateBuildReasoning(model,effort);renderBuildStatus();markDraft();
  });
  $("interface-language").addEventListener("change",() => { renderLanguage();markDraft(); });
  $("api-model").addEventListener("change",() => { populateReasoning($("api-model").value,$("api-reasoning-effort").value);markDraft(); });
  for (const id of ["enabled","build-reasoning-effort","api-reasoning-effort","api-concurrency","web-search","x-search","language",...promptFields.map(field => field.name + "-prompt")]) {
    $(id).addEventListener("input",markDraft);
    $(id).addEventListener("change",markDraft);
  }
  function restorePrompt(field) {
    $(field.name + "-prompt").value = core.DEFAULT_PROMPTS[field.name];
  }
  for (const field of promptFields) {
    $("reset-" + field.name + "-prompt").addEventListener("click",() => {
      if (busy) return;
      restorePrompt(field);setStatus("options.promptsReset");
    });
  }
  $("reset-prompts").addEventListener("click",() => {
    if (busy) return;
    for (const field of promptFields) restorePrompt(field);
    setStatus("options.promptsReset");
  });
  $("fast-preset").addEventListener("click",() => {
    $("api-model").value = "grok-4.3";
    populateReasoning("grok-4.3","none");
    $("api-concurrency").value = 4;
    showExplanationMode();setStatus("options.presetReady");
  });
  $("reload-extension").addEventListener("click",() => {
    if (busy) return;setStatus("options.reloading");chrome.runtime.reload();
  });
  $("api-key").addEventListener("input",() => { keyChanged = $("api-key").value.trim() !== originalKey.trim();renderSecurity();markDraft(); });
  $("remember-key").addEventListener("change",() => { rememberChanged = $("remember-key").checked !== security.remember;renderSecurity();markDraft(); });
  async function syncAfterSecurityAction(preserveDraft = false) {
    try {
      await refreshSecurity();
      if (!preserveDraft) $("remember-key").checked = security.remember;
      rememberChanged = $("remember-key").checked !== security.remember;
    } catch {
      // Do not permit saving if the current Key state cannot be read after a
      // partially failed mutation.
      securityLoaded = false;
    }
  }
  $("settings-form").addEventListener("submit",async event => {
    event.preventDefault();
    if (busy || (!isBuild() && !securityLoaded) || !event.currentTarget.reportValidity()) return;
    const oversized = promptFields.find(field => $(field.name + "-prompt").value.length > promptLimit);
    if (oversized) {
      setStatus("options.promptTooLong","error",{limit:promptLimit});
      $(oversized.name + "-prompt").focus();return;
    }
    const settings = core.normalizeSettings({
      ...currentSettings,
      enabled:$("enabled").checked,
      provider:$("provider").value,
      buildTransport:$("build-transport").value,
      buildModel:$("build-model").value,
      buildReasoningEffort:$("build-reasoning-effort").value,
      explanationMode:$("explanation-mode").value,
      apiModel:$("api-model").value.trim(),
      apiReasoningEffort:$("api-reasoning-effort").value,
      apiConcurrency:Number($("api-concurrency").value),
      apiVerification:"only",
      webSearch:$("web-search").checked,
      xSearch:$("x-search").checked,
      language:$("language").value,
      interfaceLanguage:$("interface-language").value,
      verifyPrompt:$("verify-prompt").value,
      commentsPrompt:$("comments-prompt").value,
    });
    const apiKey = $("api-key").value.trim();
    const saveKey = !isBuild() && keyNeedsSave();
    const remember = $("remember-key").checked;
    if (saveKey && !apiKey) {
      setStatus("options.keyRequired","error");$("api-key").focus();return;
    }
    if (saveKey && (apiKey.length > 500 || /[\r\n]/.test(apiKey))) {
      setStatus("errors.keyInvalid","error");$("api-key").focus();return;
    }
    if (!isBuild() && !core.API_MODELS.some(item => item.value === $("api-model").value)
      && $("api-model").value !== currentSettings.apiModel) {
      setStatus("options.modelInvalid","error");$("api-model").focus();return;
    }
    if (!isBuild() && (!$("api-reasoning-effort").value || $("api-reasoning-effort").value !== settings.apiReasoningEffort)) {
      setStatus("options.reasoningInvalid","error");$("api-reasoning-effort").focus();return;
    }
    if (isBuild() && (!buildModelChoices().some(item => item.value === $("build-model").value)
      || Array.isArray(buildStatus?.modelCatalog) && !buildStatus.modelCatalog.some(item => (typeof item === "string" ? item : item.id) === settings.buildModel && item.available !== false))) {
      setStatus("options.buildModelUnavailable","error",{model:settings.buildModel});$("build-model").focus();return;
    }
    if (isBuild() && (!$("build-reasoning-effort").value || $("build-reasoning-effort").value !== settings.buildReasoningEffort)) {
      setStatus("options.reasoningInvalid","error");$("build-reasoning-effort").focus();return;
    }
    if (!settings.webSearch && !settings.xSearch) {
      setStatus("options.urlSearchRequired","error");$("x-search").focus();return;
    }
    setBusy(true);setStatus("options.saving");
    try {
      // Apply a replacement Key and its settings in one worker transaction.
      // A settings-only save never erases or replaces an untouched credential.
      if (saveKey) {
        await send({type:"SAVE_KEY",apiKey,remember,settings});
        keyChanged = false;rememberChanged = false;
        originalKey = apiKey;
      } else await send({type:"SAVE_SETTINGS",settings});
      currentSettings = settings;
      if (!isBuild()) await refreshSecurity();
      populate(currentSettings);renderLanguage();
      setStatus("options.saved");
    } catch (error) {
      setStatus("errors.operation","error",{error:error.message});
      // Re-read the actual state, retaining a replacement draft for retry.
      await syncAfterSecurityAction(true);
    }
    finally { setBusy(false); }
  });
  $("clear-key").addEventListener("click",async () => {
    if (busy || isBuild()) return;setBusy(true);
    try {
      await send({type:"SAVE_KEY",apiKey:"",remember:$("remember-key").checked});
      keyInputClear();rememberChanged = false;await refreshSecurity();setStatus("options.keyCleared");
    } catch (error) {
      setStatus("errors.operation","error",{error:error.message});
      // A failed storage operation may leave a changed credential state.
      // Reflect the worker's actual state instead of assuming it was cleared.
      try { await refreshSecurity(true); } catch { securityLoaded = false; }
    }
    finally { rememberChanged = false;await syncAfterSecurityAction();setBusy(false); }
  });
  $("clear-cache").addEventListener("click",async () => {
    if (busy) return;setBusy(true);
    try { await send({type:"CLEAR_CACHE"});setStatus("options.cacheCleared"); }
    catch (error) { setStatus("errors.operation","error",{error:error.message}); }
    finally { setBusy(false); }
  });
  async function loadHistory() {
    try {const result=await send({type:"GET_HISTORY_STATUS"});if(typeof result.enabled!=="boolean")throw new Error(ui.t("errors.noResponse",uiLanguage));$("history-enabled").checked=result.enabled;historyReady=true;}
    catch {historyReady=false;setHistoryStatus("history.error");}
    $("history-enabled").disabled=busy||historyBusy||!historyReady;
  }
  $("history-enabled").addEventListener("change",async () => {
    if(busy||historyBusy||!historyReady)return;
    const desired=$("history-enabled").checked;historyBusy=true;$("history-enabled").disabled=true;
    try {const result=await send({type:"SET_HISTORY_ENABLED",enabled:desired});if(typeof result.enabled!=="boolean")throw new Error("Invalid history response");$("history-enabled").checked=result.enabled;setHistoryStatus("history.saved");}
    catch {$("history-enabled").checked=!desired;setHistoryStatus("history.error");}
    finally {historyBusy=false;$("history-enabled").disabled=busy||!historyReady;}
  });
  $("open-history").addEventListener("click",async () => {
    try {await send({type:"OPEN_HISTORY"});}
    catch {setHistoryStatus("history.error");}
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "UI_LANGUAGE_CHANGED") { localeRevision++;applyLanguage(message.language); }
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === "local" && changes.uiLanguage) { localeRevision++;applyLanguage(changes.uiLanguage.newValue); }
    if(area==="local"&&changes.superxHistoryEnabled&&!historyBusy){$("history-enabled").checked=changes.superxHistoryEnabled.newValue!==false;historyReady=true;$("history-enabled").disabled=busy;}
    if (area === "local" && changes.settings && !busy) {
      const previousInterfaceLanguage = currentSettings.interfaceLanguage;
      const interfaceDraft = $("interface-language").value !== previousInterfaceLanguage;
      const nextSettings = core.normalizeSettings(changes.settings.newValue);
      // Other Settings tabs can change the interface without discarding this
      // tab's answer language, prompts, or replacement Key drafts.
      currentSettings = {...currentSettings,interfaceLanguage:nextSettings.interfaceLanguage};
      if (!interfaceDraft) populateInterfaceLanguages(nextSettings.interfaceLanguage);
      renderLanguage();markDraft();
    }
    if (area === "session" && changes.superxOptionsFocus) void consumeOptionsFocus();
    if (!busy && (area === "session" && (changes.apiKey || changes.securityFault) || area === "local" && (changes.apiKeyEncrypted || changes.apiKey || changes.apiKeyVault || changes.rememberApiKey))) {
      refreshSecurity(true,true).then(() => {
        if (!rememberChanged) $("remember-key").checked = security.remember;
        rememberChanged = $("remember-key").checked !== security.remember;
        renderSecurity();
        if (statusMessage?.key === "options.unsavedChanges") markDraft();
      }).catch(() => { securityLoaded = false;setStatus("errors.noResponse","error");renderSecurity(); });
    }
  });
  applyLanguage(observedUILanguage);load();void loadHistory();
})();
