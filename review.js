async function fetchDuplicates() {
  const resp = await chrome.runtime.sendMessage({ action: 'fetchDuplicates' });
  return resp;
}

function el(tag, cls, attrs = {}){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function renderList(dups){
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (!dups || dups.length===0){
    list.innerHTML = '<div class="loading">No duplicate tabs found.</div>';
    document.getElementById('summary').textContent = 'No duplicates';
    return;
  }

  dups.forEach(d => {
    const item = el('div','item');
    const chk = el('input','checkbox'); chk.type='checkbox'; chk.className='checkbox'; chk.dataset.id = d.id;
    const favicon = el('div','favicon');
    if (d.faviconUrl){ const img = document.createElement('img'); img.src=d.faviconUrl; img.style.width='100%'; img.style.height='100%'; img.onerror=()=>img.style.display='none'; favicon.appendChild(img); }
    else favicon.textContent = '📄';
    const info = el('div','info');
    const title = el('p','title'); title.textContent = d.title || 'Untitled';
    const url = el('p','url'); url.textContent = d.url;
    info.appendChild(title); info.appendChild(url);
    item.appendChild(chk); item.appendChild(favicon); item.appendChild(info);
    list.appendChild(item);
  });
}

function getSelectedIds(){
  return Array.from(document.querySelectorAll('.checkbox')).filter(c=>c.checked).map(c=>parseInt(c.dataset.id));
}

async function removeByIds(ids){
  const resp = await chrome.runtime.sendMessage({ action: 'removeDuplicatesByIds', tabIds: ids });
  return resp;
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const data = await fetchDuplicates();
  const summary = document.getElementById('summary');
  if (data && data.success){
    renderList(data.duplicates);
    summary.textContent = `Found ${data.duplicates.length} duplicate tab(s)`;
  } else {
    document.getElementById('list').innerHTML = `<div class="loading">${data && data.message ? data.message : 'Error fetching duplicates'}</div>`;
    summary.textContent = 'Error';
  }

  document.getElementById('selectAll').addEventListener('change',(e)=>{
    const checked = e.target.checked;
    document.querySelectorAll('.checkbox').forEach(c=>c.checked = checked);
  });

  document.getElementById('removeSelected').addEventListener('click', async ()=>{
    const ids = getSelectedIds();
    if (ids.length===0){ alert('Select at least one tab to remove'); return; }
    const res = await removeByIds(ids);
    const result = document.getElementById('result');
    if (res && res.success){
      result.textContent = `Removed ${res.removedCount} tab(s)`; result.hidden=false; setTimeout(()=>result.hidden=true,3000);
      // refresh list
      const d = await fetchDuplicates(); renderList(d.duplicates); document.getElementById('summary').textContent = `Found ${d.duplicates.length} duplicate tab(s)`;
    } else {
      result.textContent = `Error: ${res && res.message ? res.message : 'unknown'}`; result.hidden=false; setTimeout(()=>result.hidden=true,4000);
    }
  });

  document.getElementById('closeBtn').addEventListener('click', ()=>{ window.close(); });
});
