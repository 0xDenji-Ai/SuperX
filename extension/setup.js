(async function(){
  'use strict';
  const UI=globalThis.GrokFirstUI,$=id=>document.getElementById(id);
  let locale='en',os=/Mac/i.test(navigator.userAgentData?.platform||navigator.platform||'')?'macos':'windows';
  try{const config=await chrome.runtime.sendMessage({type:'GET_UI_LANGUAGE'});const local=await chrome.storage.local.get('settings');locale=UI.resolveLanguage(local.settings?.interfaceLanguage,config?.language||navigator.language);}catch{/* English documentation fallback. */}
  const t=key=>UI.t(key,locale),zh=locale.startsWith('zh');
  const copy=zh?{
    title:'连接 Grok Build',intro:'通过官方 Grok Build 登录使用 SuperX。支持 Windows x64，以及 Apple 芯片或 Intel Mac；连接器需要单独安装。',
    downloadTitle:'1. 下载并解压连接器',downloadText:'在同一版本的 GitHub Release 附件中找到 SuperX-Connector-<版本>.zip，解压到一个文件夹。',download:'打开 Releases',candidate:'本地测试版尚未发布时，请使用随测试版提供的连接器 ZIP。不要运行来源不明的安装器。',idLabel:'此 SuperX 安装的扩展 ID',
    installTitle:'2. 安装到当前用户',windowsText:'在解压目录打开 PowerShell，运行下方命令。安装器会下载经摘要校验的官方 Node 和 Grok Build，无需管理员权限或 npm。',macText:'在解压目录打开终端，运行下方命令。支持 Apple 芯片与 Intel；无需 sudo、Node 或 npm。',windowsNote:'如果 PowerShell 策略阻止脚本，可检查下载的脚本后按本机策略允许本次运行；无需更改系统级策略。',macNote:'如果 macOS 提示无法打开，请先检查下载来源，并按系统提示批准此脚本；无需关闭 Gatekeeper。',
    loginTitle:'3. 使用官方账号登录',loginText:'运行安装目录中的登录脚本，按官方浏览器提示完成登录。已有官方 Grok Build 登录可以复用。',loginNote:'登录由官方 Grok Build 处理。SuperX 不读取或复制登录凭据，不修改你的 Grok 个人配置。',
    connectTitle:'4. 回到 SuperX 检查并保存',connectText:'点击检查连接，允许本机连接权限。确认就绪后回到设置，选择 Grok Build、模型和推理档位，再保存。检查连接本身不生成回答。',
    notesTitle:'使用说明',data:'帖子及指令交给本机官方 Grok Build，再由它发送至提供方。它使用独立的临时工作目录和受限工具配置。',usage:'两种模式的用量和账单取决于账号及提供方规则；连接器不承诺无限量、免费使用或节省额度，也不会自动切换计费方式。',model:'ACP 复用本地进程，CLI 每次任务运行独立命令；都使用同一官方账号。可视帖子立即排队，Build 逐项执行。只有服务方确认可用的模型和推理档位才能运行。',error:'登录过期、额度限制或连接中断会停止该次任务，不自动重发。受企业管理策略约束的设备可能无法连接；可使用 API Key 模式或联系管理员，不要删除公司策略。',docs:'详细连接说明',official:'官方 Grok Build'
  }:{
    title:'Connect Grok Build',intro:'Use SuperX with your official Grok Build login. Supports Windows x64 and Apple silicon / Intel Macs. Install the local connector separately.',
    downloadTitle:'1. Download and extract the connector',downloadText:'Find SuperX-Connector-<version>.zip in the matching GitHub Release assets and extract it to a folder.',download:'Open Releases',candidate:'For an unpublished local candidate, use the connector ZIP provided with that candidate. Only run installers from a source you trust.',idLabel:'Extension ID of this SuperX installation',
    installTitle:'2. Install for the current user',windowsText:'Open PowerShell in the extracted folder and run the command below. The installer downloads hash-checked official Node and Grok Build runtimes. No administrator access or npm required.',macText:'Open Terminal in the extracted folder and run the command below. Both Apple silicon and Intel Macs are supported. No sudo, Node or npm required.',windowsNote:'If PowerShell policy blocks the script, inspect the downloaded script and follow your local policy to allow this run. No system-wide policy change is needed.',macNote:'If macOS blocks the script, check its source and follow the system approval prompts. You do not need to disable Gatekeeper.',
    loginTitle:'3. Sign in with your official account',loginText:'Run the login script in the installed connector directory and complete the official browser sign-in. An existing official Grok Build login can be reused.',loginNote:'Official Grok Build handles login. SuperX does not read or copy login credentials, or modify your personal Grok configuration.',
    connectTitle:'4. Check and save in SuperX',connectText:'Check the connection and allow native messaging. Once ready, return to Settings, select Grok Build, a model and reasoning effort, then save. Checking alone does not generate an answer.',
    notesTitle:'Using the connection',data:'Post context and instructions pass to the local official Grok Build client, which sends them to its provider. It uses a separate temporary working directory and a restricted tool profile.',usage:'Usage and billing depend on your account and provider rules. The connector does not promise unlimited, free or lower-quota use, or switch billing routes automatically.',model:'ACP reuses a local process; CLI runs a separate command per task. Both use the same official account. Visible posts queue immediately; Build executes them one at a time. Models and effort levels must be confirmed by the provider.',error:'Expired login, usage limits or disconnections stop the task without automatic resubmission. Enterprise-managed devices may be unsupported; use API Key mode or contact your administrator. Do not delete company policies.',docs:'Detailed connection guide',official:'Official Grok Build'
  };
  document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
  const mapping={'title':'title','intro':'intro','download-title':'downloadTitle','download-text':'downloadText','download':'download','candidate':'candidate','id-label':'idLabel','install-title':'installTitle','login-title':'loginTitle','login-text':'loginText','login-note':'loginNote','connect-title':'connectTitle','connect-text':'connectText','notes-title':'notesTitle','note-data':'data','note-usage':'usage','note-model':'model','note-error':'error','docs':'docs','official':'official'};
  for(const [id,key]of Object.entries(mapping))$(id).textContent=copy[key];
  $('settings').textContent=t('common.settings');$('check').textContent=t('options.checkBuild');
  for(const id of ['copy-id','copy-command','copy-login'])$(id).textContent=t('common.copy');
  const extensionId=/^[a-p]{32}$/.test(chrome.runtime.id)?chrome.runtime.id:'clcflilaihhnnglfamdblhopokpnlioo';$('extension-id').value=extensionId;
  function renderOS(){
    for(const id of ['windows','macos'])$(id).setAttribute('aria-pressed',String(os===id));
    $('install-text').textContent=copy[os==='windows'?'windowsText':'macText'];$('install-note').textContent=copy[os==='windows'?'windowsNote':'macNote'];
    $('install-command').textContent=os==='windows'?`.\\install-windows.ps1 -ExtensionId ${extensionId}`:`bash ./install-macos.command --extension-id ${extensionId}`;
    $('login-command').textContent=os==='windows'?'& "$env:LOCALAPPDATA\\SuperX\\Connector\\login-windows.ps1"':'bash "$HOME/Library/Application Support/SuperX/Connector/login-macos.command"';
  }
  for(const id of ['windows','macos'])$(id).addEventListener('click',()=>{os=id;renderOS();});renderOS();
  for(const [button,target]of [['copy-id','extension-id'],['copy-command','install-command'],['copy-login','login-command']])$(button).addEventListener('click',async()=>{try{await navigator.clipboard.writeText($(target).value||$(target).textContent);$(button).textContent=t('common.copied');}catch{$(button).textContent=t('common.copyFailed');}});
  $('settings').addEventListener('click',()=>chrome.runtime.sendMessage({type:'OPEN_SETTINGS',focus:'build'}));
  $('check').addEventListener('click',async()=>{
    // Invoke permission in the click gesture, before any asynchronous status work.
    const permission=chrome.permissions.request({permissions:['nativeMessaging']});$('check').disabled=true;$('status').textContent=t('build.checking');
    try{if(!await permission){$('status').textContent=t('build.permission');return;}
      const result=await chrome.runtime.sendMessage({type:'GET_BUILD_STATUS'});
      const key=result?.ready?'build.ready':result?.errorCode==='BUILD_LOGIN_REQUIRED'?'build.login':result?.errorCode==='BUILD_NATIVE_MISSING'?'build.missing':'build.unavailable';$('status').textContent=t(key);
    }catch{$('status').textContent=t('build.unavailable');}finally{$('check').disabled=false;}
  });
})();
