const $ = (id) => document.getElementById(id);
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const files = [
  {name:'file-transfer.md',dir:'docs',size:'3.9 KB',age:'4 分钟前'},
  {name:'OVERVIEW.md',dir:'',size:'7.1 KB',age:'4 分钟前'},
  {name:'messages.ts',dir:'client',size:'7.5 KB',age:'4 分钟前'},
  {name:'files-view.tsx',dir:'client',size:'18 KB',age:'4 分钟前'},
  {name:'README.md',dir:'',size:'4.1 KB',age:'19 分钟前'},
  {name:'files-button.ts',dir:'client',size:'2.4 KB',age:'20 分钟前'},
  {name:'transfer.ts',dir:'server',size:'12 KB',age:'35 分钟前'},
  {name:'transfer-format.ts',dir:'client',size:'2.1 KB',age:'42 分钟前'},
  {name:'recent-files.ts',dir:'server',size:'4.2 KB',age:'1 小时前'},
  {name:'package.json',dir:'',size:'796 B',age:'2 小时前'}
];
const localFiles = [
  {name:'design-reference.png',size:'2.4 MB'},
  {name:'产品需求.pdf',size:'840 KB'},
  {name:'sample-data.csv',size:'128 KB'},
  {name:'app-icon.svg',size:'4.8 KB'}
];
let selected = [];
let showAll = false;
let activeDirection = 'receive';
let localFolder = '~/Downloads/Paseo';
let remoteFolder = '~/projects/ssh-browser';
let toastTimer;
let jobId = 0;
const jobs = [];
const fileKey = (file) => [file.dir,file.name].filter(Boolean).join('/');
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},3500);}
function renderFiles(){
  const query=$('search').value.trim();
  const matched=files.filter(file=>fileKey(file).toLowerCase().includes(query.toLowerCase()));
  const displayed=query||showAll?matched:matched.slice(0,6);
  $('clear-search').hidden=!query;$('search-shortcut').hidden=!!query;
  $('list-label').textContent=query?'搜索结果':'最近改动';
  $('list-period').textContent=query?`${matched.length} 个文件`:'最近 6 小时';
  $('show-more').hidden=!!query||matched.length<=6;
  $('show-more').innerHTML=`${showAll?'收起列表':'展开其余 4 个文件'}${icon('chevron',`small ${showAll?'':'chevron-down'}`)}`;
  let html=displayed.map(file=>{
    const job=jobs.findLast(j=>j.direction==='receive'&&j.source===fileKey(file));
    const running=job?.status==='running',done=job?.status==='done';
    return `<button class="file-row ${running?'is-running':done?'is-done':''}" data-file="${escapeHtml(fileKey(file))}" aria-label="${done?'再次下载':'下载'} ${escapeHtml(file.name)} 到本机" title="${done?'已保存到本机，点击再次下载':'下载到本机'}" ${running?'disabled':''}>${icon('file','file-icon')}<span class="file-info"><span class="file-name">${escapeHtml(file.name)}</span><span class="file-meta">${[file.dir,file.size,file.age].filter(Boolean).join(' · ')}</span></span><span class="row-action">${running?`${job.progress}%`:icon(done?'check':'download')}</span></button>`;
  }).join('');
  if(!matched.length){
    if(query.startsWith('/')||query.startsWith('~/')) html=`<button class="file-row path-row" data-path="${escapeHtml(query)}" aria-label="下载 ${escapeHtml(query)} 到本机" title="下载到本机">${icon('file','file-icon')}<span class="file-info"><span class="file-name">${escapeHtml(query)}</span><span class="file-meta">devbox 上的文件</span></span><span class="row-action">${icon('download')}</span></button>`;
    else html='<p class="empty-state">未找到匹配文件</p>';
  }
  $('file-list').innerHTML=html;
}
function renderSelected(){
  $('selected-files').hidden=!selected.length;$('send-empty').hidden=selected.length>0;
  $('selected-files').innerHTML=selected.map(file=>{
    const job=jobs.find(job=>job.id===file.jobId),running=job?.status==='running',done=job?.status==='done',cancelled=job?.status==='cancelled';
    const action=done?`data-reveal="${job.id}"`:running?`data-cancel="${job.id}"`:cancelled?`data-retry="${job.id}"`:`data-remove="${escapeHtml(file.name)}"`;
    const label=done?'复制主机路径':running?`取消发送 ${file.name}`:cancelled?`重试 ${file.name}`:`移除 ${file.name}`;
    return `<div class="selected-row ${done?'done':''}" data-send-file="${escapeHtml(file.name)}" aria-label="${escapeHtml(file.name)}${done?' · 已完成':running?' · 正在发送':cancelled?' · 已取消':''}">${icon(done?'check':'file')}<span class="file-name" title="${escapeHtml(file.name)}${cancelled?' · 已取消':''}">${escapeHtml(file.name)}</span><span class="file-size">${running?job.progress+'%':cancelled?'已取消':file.size}</span><button class="icon-button" type="button" ${action} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(done?'copy':cancelled?'refresh':'x','small')}</button>${running?`<div class="queue-progress" role="progressbar" aria-label="${escapeHtml(file.name)} 传输进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${job.progress}"><div style="width:${job.progress}%"></div></div>`:''}</div>`;
  }).join('');
  const pending=selected.filter(file=>!file.jobId);
  const running=selected.some(file=>jobs.find(job=>job.id===file.jobId)?.status==='running');
  const done=selected.length>0&&selected.every(file=>jobs.find(job=>job.id===file.jobId)?.status==='done');
  $('send-files').textContent=pending.length?`发送 ${pending.length} 个文件`:running?'发送中…':done?'已发送':'发送';
  $('send-files').disabled=!pending.length;
}
function renderJobs(){
  renderSelected();
  const visibleJobs=activeDirection==='receive'?jobs.filter(job=>job.direction==='receive'):[];
  $('transfers-section').hidden=!visibleJobs.length;
  $('clear-completed').hidden=!visibleJobs.some(j=>j.status!=='running');
  $('transfers').innerHTML=[...visibleJobs].reverse().map(job=>{
    const sending=job.direction==='send',done=job.status==='done',cancelled=job.status==='cancelled';
    return `<div class="transfer-job ${done?'done':''}" aria-label="${escapeHtml(job.name)} · ${done?'已完成':cancelled?'已取消':job.progress+'%'}">${icon(done?'check':sending?'upload':'download')}<div class="job-content"><div class="job-top"><span class="job-name">${escapeHtml(job.name)}</span><span class="job-size">${job.size}</span></div>${!done&&!cancelled?`<div class="progress-track" role="progressbar" aria-label="${escapeHtml(job.name)} 传输进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${job.progress}"><div class="progress-fill" style="width:${job.progress}%"></div></div><div class="job-state">${sending?'正在发送':'正在下载'} · ${job.progress}%</div>`:cancelled?'<div class="job-state">已取消</div>':''}</div>${done?`<button class="icon-button" data-reveal="${job.id}" aria-label="${sending?'复制主机路径':'查看本机保存位置'}" title="${sending?'复制主机路径':'查看本机保存位置'}">${icon(sending?'copy':'folder')}</button>`:cancelled?`<button class="icon-button" data-retry="${job.id}" aria-label="重试 ${escapeHtml(job.name)}">${icon('refresh')}</button>`:`<button class="icon-button" data-cancel="${job.id}" aria-label="取消 ${escapeHtml(job.name)}">${icon('x')}</button>`}</div>`;
  }).join('');
}
function startTransfer(file,direction,source){
  const job={id:++jobId,name:file.name,size:file.size,source:source??fileKey(file),direction,destination:direction==='send'?remoteFolder:`${localFolder}/ssh-browser`,status:'running',progress:0};
  jobs.push(job);renderJobs();renderFiles();
  job.timer=setInterval(()=>{
    job.progress=Math.min(100,job.progress+7+job.id%5);
    if(job.progress===100){job.status='done';clearInterval(job.timer);toast(direction==='send'?`${job.name} 已发送到 devbox`:`${job.name} 已保存到本机`);}
    renderJobs();renderFiles();
  },280);
  return job;
}
$('file-list').addEventListener('click',event=>{
  const row=event.target.closest('[data-file],[data-path]');if(!row)return;
  const file=row.dataset.file?files.find(f=>fileKey(f)===row.dataset.file):{name:row.dataset.path.split('/').pop(),size:'16 KB'};
  startTransfer(file,'receive',row.dataset.file??row.dataset.path);
});
$('search').addEventListener('input',renderFiles);
$('search').addEventListener('keydown',event=>{if(event.key==='Enter')$('file-list').querySelector('button')?.click();});
$('clear-search').onclick=()=>{$('search').value='';renderFiles();$('search').focus();};
$('show-more').onclick=()=>{showAll=!showAll;renderFiles();};
$('choose-files').onclick=()=>{
  $('picker-files').innerHTML=localFiles.map(file=>{
    const entry=selected.find(item=>item.name===file.name),running=entry&&jobs.find(job=>job.id===entry.jobId)?.status==='running';
    return `<label class="picker-row"><input type="checkbox" value="${escapeHtml(file.name)}" ${entry&&(!entry.jobId||running)?'checked':''} ${running?'disabled':''}>${icon('file')}<span class="file-info"><span class="file-name">${escapeHtml(file.name)}</span><span class="file-meta">${file.size}</span></span></label>`;
  }).join('');
  updatePicker();$('picker-dialog').showModal();
};
function updatePicker(){const n=$('picker-files').querySelectorAll('input:checked:not(:disabled)').length;$('picker-count').textContent=n?`已选择 ${n} 个文件`:'未选择文件';$('confirm-pick').disabled=!n;}
$('picker-files').addEventListener('change',updatePicker);
$('confirm-pick').onclick=()=>{
  const names=[...$('picker-files').querySelectorAll('input:checked:not(:disabled)')].map(input=>input.value);
  selected=selected.filter(file=>file.jobId||names.includes(file.name));
  for(const name of names){
    const file={...localFiles.find(file=>file.name===name)},index=selected.findIndex(item=>item.name===name);
    if(index===-1)selected.push(file);
    else if(selected[index].jobId)selected[index]=file;
  }
  renderSelected();$('picker-dialog').close();$('send-files').focus();
};
$('selected-files').addEventListener('click',event=>{
  const button=event.target.closest('[data-remove]');
  if(button){selected=selected.filter(f=>f.name!==button.dataset.remove);renderSelected();}
  else void handleTransferAction(event);
});
$('send-form').onsubmit=event=>{
  event.preventDefault();
  if(!finishRemoteEdit())return;
  selected.filter(file=>!file.jobId).forEach(file=>{file.jobId=startTransfer(file,'send',file.name).id;});
  renderSelected();
  $('choose-files').focus();
};
function finishRemoteEdit(){
  const input=$('remote-input'),value=input.value.trim();
  if(!value){input.setCustomValidity('请输入主机上的目标目录');input.reportValidity();return false;}
  remoteFolder=value;input.value=value;input.title=value;input.readOnly=true;
  $('edit-remote').textContent='修改';
  return true;
}
$('edit-remote').onclick=()=>{
  const input=$('remote-input');
  if(input.readOnly){input.readOnly=false;$('edit-remote').textContent='完成';input.focus();}
  else if(finishRemoteEdit())$('edit-remote').focus();
};
$('remote-input').oninput=()=>{$('remote-input').setCustomValidity('');};
$('remote-input').onkeydown=event=>{
  if($('remote-input').readOnly)return;
  if(event.key==='Enter'){event.preventDefault();if(finishRemoteEdit())$('edit-remote').focus();}
  if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();
    $('remote-input').value=remoteFolder;$('remote-input').setCustomValidity('');
    finishRemoteEdit();$('edit-remote').focus();
  }
};
$('change-folder').onclick=()=>{$('folder-input').value=localFolder;$('folder-preview').textContent=`${localFolder}/ssh-browser`;$('folder-error').hidden=true;$('folder-dialog').showModal();};
$('folder-input').oninput=()=>{$('folder-preview').textContent=`${$('folder-input').value.trim().replace(/\/+$/,'')}/ssh-browser`;$('folder-error').hidden=true;};
$('save-folder').onclick=()=>{const value=$('folder-input').value.trim();if(!value.startsWith('/')&&!value.startsWith('~/')){$('folder-error').hidden=false;return;}localFolder=value.replace(/\/+$/,'');$('local-path').innerHTML=`<span class="location-parent">${escapeHtml(localFolder)}/</span><span class="location-leaf">ssh-browser</span>`;$('local-path').title=`本机保存位置：${localFolder}/ssh-browser`;$('folder-dialog').close();};
async function handleTransferAction(event){
  const button=event.target.closest('[data-cancel],[data-retry],[data-reveal]');if(!button)return;
  const job=jobs.find(j=>j.id===Number(button.dataset.cancel??button.dataset.retry??button.dataset.reveal));
  if(button.hasAttribute('data-cancel')){clearInterval(job.timer);job.status='cancelled';renderJobs();renderFiles();}
  else if(button.hasAttribute('data-retry')){
    jobs.splice(jobs.indexOf(job),1);
    const retried=startTransfer(job,job.direction,job.source);retried.destination=job.destination;
    if(job.direction==='send'){selected.find(file=>file.jobId===job.id).jobId=retried.id;renderSelected();}
  }
  else if(job.direction==='send'){
    try{await navigator.clipboard.writeText(`${job.destination}/${job.name}`);toast('已复制主机文件路径');}catch{toast(`${job.destination}/${job.name}`);}
  }else toast(`演示保存位置：${job.destination}/${job.name}`);
}
$('transfers').addEventListener('click',handleTransferAction);
$('clear-completed').onclick=()=>{for(let i=jobs.length-1;i>=0;i--)if(jobs[i].direction===activeDirection&&jobs[i].status!=='running')jobs.splice(i,1);renderJobs();renderFiles();};
function setDirection(direction){
  activeDirection=direction;
  for(const name of ['receive','send']){
    const active=name===direction;
    $(name+'-tab').setAttribute('aria-selected',String(active));
    $(name+'-tab').tabIndex=active?0:-1;
    $(name+'-panel').hidden=!active;
  }
  renderJobs();
}
for(const direction of ['receive','send']){
  $(direction+'-tab').onclick=()=>setDirection(direction);
  $(direction+'-tab').onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?'receive':event.key==='End'?'send':activeDirection==='receive'?'send':'receive';
    setDirection(next);$(next+'-tab').focus();
  };
}
function setPanel(open){$('transfer-panel').hidden=!open;$('closed-state').hidden=open;$('toggle-panel').setAttribute('aria-expanded',String(open));if(!open)$('toggle-panel').focus();}
$('toggle-panel').onclick=()=>setPanel($('transfer-panel').hidden);$('close-panel').onclick=()=>setPanel(false);$('reopen-panel').onclick=()=>setPanel(true);
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){event.preventDefault();setPanel(true);setDirection('receive');$('search').focus();}if(event.key==='Escape'&&!document.querySelector('dialog[open]'))setPanel(false);});
renderFiles();renderSelected();renderJobs();
if(new URLSearchParams(location.search).get('tab')==='send')setDirection('send');
