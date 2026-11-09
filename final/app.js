(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = window.CenterModel.createStore(message => { $('warning').textContent = message; $('warning').hidden = false; });
  const state = () => store.state;
  const resource = id => state().resources.find(r => r.id === id);
  const collection = id => state().collections.find(c => c.id === id);
  const instructor = () => state().profile.role === 'instructor';
  const editable = c => c.kind === 'personal' || instructor();
  const unique = values => [...new Set(values)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const activeResources = () => state().resources.filter(r=>r.status!=='superseded');
  const sourceVersion = r => r.sourceUrl ? '' : ` · ${e(r.version)}`;
  const requirementBadge = (c,id) => c?.requirements[id] && c.requirements[id]!=='Unspecified' ? badge(c.requirements[id]) : '';
  const time = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
  const route = () => { const [page, query = ''] = location.hash.slice(1).split('?'); return {page: page || 'home', params: new URLSearchParams(query)}; };
  const href = (page, values = {}) => `#${page}${Object.keys(values).length ? '?' + new URLSearchParams(values).toString() : ''}`;
  const go = (page, values) => { const next = href(page, values); if (location.hash === next) render(); else location.hash = next; };
  const button = (text, action, attrs = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${e(text)}</button>`;
  const link = (text, page, values = {}, cls = 'button') => `<a class="${cls}" href="${href(page, values)}">${e(text)}</a>`;
  const badge = (text, cls = '') => `<span class="badge ${cls}">${e(text)}</span>`;
  const empty = (title, text, action = '') => `<div class="empty"><span aria-hidden="true">▤</span><h2>${e(title)}</h2><p>${e(text)}</p>${action}</div>`;
  const title = (heading, text, actions = '') => `<div class="page-heading"><div><div class="eyebrow">CS6750 / INFORMATION CENTER</div><h1>${e(heading)}</h1><p>${e(text)}</p></div><div class="actions">${actions}</div></div>`;
  const options = (values, selected, all = '') => `${all ? `<option value="">${e(all)}</option>` : ''}${values.map(v => `<option value="${e(typeof v === 'string' ? v : v.value)}"${selected === (typeof v === 'string' ? v : v.value) ? ' selected' : ''}>${e(typeof v === 'string' ? v : v.label)}</option>`).join('')}`;
  const field = (label, name, value = '', extra = '') => `<label>${e(label)}<input name="${name}" value="${e(value)}" ${extra}></label>`;
  let toastTimer, study = null, dialogSubmit = null, dialogTrigger = null;
  let ytPromise = null, currentRoute = '', blobUrls = [];

  function notice(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
  function status() {
    $('storage-label').textContent = store.storageStatus === 'saved' ? 'Saved on this device' : store.storageStatus === 'conflict' ? 'Reload needed' : 'Session only';
    $('account-name').textContent = state().profile.name;
    document.body.classList.toggle('instructor-mode', instructor());
  }
  function perform(fn, message = '') {
    try { const result = fn(); status(); if (message) notice(message + (store.storageStatus === 'saved' ? '' : ' — this tab only; export before closing.')); return {ok: true, result}; }
    catch (error) { $('dialog-error').textContent = error.message; notice(error.message); status(); return {ok: false}; }
  }
  function modal(heading, body, submit) {
    if (!$('dialog').open) dialogTrigger = document.activeElement;
    $('dialog-title').textContent = heading; $('dialog-body').innerHTML = body; $('dialog-error').textContent = '';
    dialogSubmit = submit || null;
    if (!$('dialog').open) $('dialog').showModal();
    $('dialog-body').querySelector('input:not([type=hidden]),textarea,select,button')?.focus();
  }
  function closeModal() { $('dialog').close(); dialogSubmit = null; if (dialogTrigger?.isConnected) dialogTrigger.focus(); }
  const formActions = text => `<div class="dialog-actions">${button('Cancel', 'close-dialog')}<button class="primary" type="submit">${e(text)}</button></div>`;
  function confirmAction(heading, text, fn) { modal(heading, `<p>${e(text)}</p><form>${formActions('Confirm')}</form>`, () => { const outcome = perform(fn); if (outcome.ok) { closeModal(); render(); } }); }
  function download(name, text, type = 'text/plain') {
    const blob = text instanceof Blob ? text : new Blob([text], {type});
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function original(r) { return r.url ? `<a class="source-link" href="${e(r.url)}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>` : '<span class="muted small">Original local content</span>'; }
  function youtubeId(url) {
    if (!url) return '';
    let parsed; try { parsed = new URL(url); } catch { return ''; }
    let id = '';
    if (['www.youtube.com','youtube.com','m.youtube.com'].includes(parsed.hostname)) id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)/.exec(parsed.pathname)?.[1];
    if (parsed.hostname === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : '';
  }
  function resourceCard(r, context = '') {
    const c = collection(context), progress = state().progress[r.id], noteCount = state().notes.filter(n => n.resourceId === r.id).length;
    return `<article class="resource-card" data-resource="${e(r.id)}">
      <div class="resource-top">${badge(r.type, r.type.toLowerCase())}${r.status === 'superseded' ? badge('Archived', 'warning') : ''}${c?.kind === 'course' ? requirementBadge(c,r.id) : ''}</div>
      <h3><a href="${href('study',{id:r.id,...(context?{from:context}:{})})}">${e(r.title)}</a></h3>
      <p>${e(r.summary)}</p><div class="resource-meta">${e(r.lesson)}${sourceVersion(r)}</div><div class="resource-source">${e(r.source)}</div>
      <div class="resource-bottom">${link(progress?'Resume':'Open resource','study',{id:r.id,...(context?{from:context}:{})},'button primary')}${button('+ Collect','collect',`data-id="${e(r.id)}"`)}<span class="small muted">${progress?.status==='reviewed'?'Reviewed':progress?'In progress':''}${noteCount?` · ${noteCount} note${noteCount===1?'':'s'}`:''}</span></div>
    </article>`;
  }
  function collectionCard(c) {
    return `<a class="collection-card ${c.kind}" href="${href('collection',{id:c.id})}"><div>${badge(c.kind==='course'?'Course collection':'My collection')}</div><h3>${e(c.title)}</h3><p>${e(c.description)}</p><div class="card-foot"><span>${c.resourceIds.length} resources · ${c.kind==='course'?'Course team':'Private'}</span><span>→</span></div></a>`;
  }
  function home() {
    const recent = Object.entries(state().progress).filter(([id])=>resource(id)?.status!=='superseded').sort((a,b)=>b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0,2);
    $('main').innerHTML = title('Your course, in one place','Find what you need. Keep your resources, notes, and study position connected.')
      + `<form id="home-search" class="hero-search"><label class="sr-only" for="home-query">Search course resources</label><span aria-hidden="true">⌕</span><input id="home-query" name="q" placeholder="Search a concept, lesson, or resource…"><button class="primary">Search</button></form>
      <div class="discovery-grid">${[['Concept','Browse the ideas you want to understand','concept'],['Lesson','Follow the course sequence','lesson'],['Collection','Course-curated or your own','collection']].map(([label,desc,mode])=>`<a class="discovery-card ${mode}" href="${href(mode==='collection'?'collections':'explore',{browse:mode})}"><span class="eyebrow">BROWSE BY</span><h2>${label}<span>→</span></h2><p>${desc}</p></a>`).join('')}</div>
      <div class="home-grid"><section><div class="section-heading"><h2>Continue studying</h2>${link('My progress →','progress',{},'text-link')}</div>${recent.length?recent.map(([id])=>resourceCard(resource(id))).join(''):`<div class="start-card"><span class="eyebrow">2.4 HUMAN ABILITIES</span><h2>Recognition and memory</h2><p>Read the CS6750 lesson alongside NN/g’s supplemental video on recognition and recall.</p>${link('Start studying','study',{id:'youtube-recognition'},'button primary')}<small>Course reading: CS6750 ATLAS · Related video: Nielsen Norman Group</small></div>`}<div class="course-shortcuts"><h2>Coursework</h2>${link('Individual Project','study',{id:'canvas-individual-project'},'related-link')}${link('Required Reading List','study',{id:'canvas-readings'},'related-link')}</div></section>
      <section><div class="section-heading"><h2>Your collections</h2>${link('View all →','collections',{},'text-link')}</div><div class="stack">${state().collections.filter(c=>['course-unit-2','course-unit-3'].includes(c.id)).map(collectionCard).join('')}${state().collections.filter(c=>c.kind==='personal').slice(0,1).map(collectionCard).join('')}</div></section></div>`;
  }
  function explore(params) {
    const concepts = unique(activeResources().flatMap(r=>r.concepts)), lessons=unique(activeResources().map(r=>r.lesson));
    $('main').innerHTML = title('Explore','Find course lessons, concepts, readings, and coursework.', instructor()?button('+ Add resource','new-resource','','primary'):'')
      + `<form id="search-form" class="search-panel"><div class="search-row"><label class="grow">Search resources<input name="q" type="search" value="${e(params.get('q'))}" placeholder="Try heuristic evaluation or recognition"></label><button class="primary">Search</button></div>
      <div class="filter-grid"><label>Concept<select name="concept">${options(concepts,params.get('concept'),'All concepts')}</select></label><label>Lesson<select name="lesson">${options(lessons,params.get('lesson'),'All lessons')}</select></label><label>Resource type<select name="type">${options(['Video','Reading','Assignment','Discussion','Reference'],params.get('type'),'All types')}</select></label><label>Collection<select name="collection">${options(state().collections.map(c=>({value:c.id,label:c.title})),params.get('collection'),'All collections')}</select></label></div>
      <div class="filter-footer"><label class="check"><input name="older" type="checkbox"${params.get('older')==='1'?' checked':''}> Include archived resources</label>${link('Clear filters','explore',{},'text-link')}</div></form><div class="section-heading"><h2 id="result-count"></h2><span class="small muted">Course titles, section outlines, and source links</span></div><div id="results" class="resource-grid"></div>`;
    const requested = params.get('browse');
    if(requested==='concept'||requested==='lesson') $('search-form').elements[requested].focus();
    searchResults();
  }
  function searchResults() {
    const form=$('search-form'), values=new FormData(form), words=String(values.get('q')).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=state().resources.filter(r=>{
      const haystack=[r.title,r.summary,r.source,r.lesson,...r.concepts,...r.sections.map(s=>s.title+' '+s.text)].join(' ').toLocaleLowerCase();
      return (values.get('older')||r.status!=='superseded') && (!values.get('type')||r.type===values.get('type'))
        && (!values.get('lesson')||r.lesson===values.get('lesson')) && (!values.get('concept')||r.concepts.includes(values.get('concept')))
        && (!values.get('collection')||collection(values.get('collection'))?.resourceIds.includes(r.id)) && words.every(word=>haystack.includes(word));
    });
    $('result-count').textContent=`${matches.length} resource${matches.length===1?'':'s'}`;
    $('results').innerHTML=matches.map(r=>resourceCard(r,String(values.get('collection')))).join('')||empty('No matching resources','Try a broader keyword or remove a filter.',link('Reset search','explore'));
  }
  function collections(params) {
    const kind=params.get('kind')==='personal'?'personal':'course';
    $('main').innerHTML=title('Collections','A collection references the original resources. It does not create duplicate copies.',button('+ Create collection','new-collection','','primary'))
      + `<nav class="tabs" aria-label="Collection type">${link('Course collections','collections',{kind:'course'},kind==='course'?'active':'')}${link('My collections','collections',{kind:'personal'},kind==='personal'?'active':'')}</nav><div class="collection-grid">${state().collections.filter(c=>c.kind===kind).map(collectionCard).join('')||empty('No collections yet','Create a collection, then add resources from Explore.',button('Create collection','new-collection','','primary'))}</div>`;
  }
  function collectionView(params) {
    const c=collection(params.get('id')); if(!c)throw new Error('This collection no longer exists.');
    const canEdit=editable(c);
    $('main').innerHTML=title(c.title,c.description, `${canEdit?button('Edit details','edit-collection',`data-id="${c.id}"`):''}${button('Export collection','export-collection',`data-id="${c.id}"`)}${canEdit?button('+ Add resources','pick-resources',`data-id="${c.id}"`,'primary'):''}`)
      + `<div class="collection-info">${badge(c.kind==='course'?'Course collection':'My collection')}${badge(c.kind==='course'?'CS6750':'Private on this device')}<span>${c.resourceIds.length} linked resources</span>${link('All collections','collections',{kind:c.kind},'text-link')}</div>
      <div class="collection-resources">${c.resourceIds.map((id,i)=>{const r=resource(id); return `<article class="collection-row"><span class="sequence">${i+1}</span><div class="grow"><div class="resource-top">${badge(r.type)}${r.status==='superseded'?badge('Archived','warning'):''}</div><h2>${link(r.title,'study',{id,from:c.id},'title-link')}</h2><p>${e(r.summary)}</p><small>${e(r.source)}${sourceVersion(r)}</small></div><div class="row-actions">${c.kind==='course'?(instructor()?`<label class="small">Requirement<select data-requirement="${id}" data-collection="${c.id}">${options(['Required','Optional','Unspecified'],c.requirements[id]||'Unspecified')}</select></label>`:requirementBadge(c,id)):''}${link('Open','study',{id,from:c.id},'button primary')}${button('+ Collect','collect',`data-id="${id}"`)}${canEdit?`<div class="mini-actions">${button('↑','move',`data-id="${id}" data-collection="${c.id}" data-direction="-1" aria-label="Move ${e(r.title)} up" ${i===0?'disabled':''}`)}${button('↓','move',`data-id="${id}" data-collection="${c.id}" data-direction="1" aria-label="Move ${e(r.title)} down" ${i===c.resourceIds.length-1?'disabled':''}`)}${button('Remove','remove-reference',`data-id="${id}" data-collection="${c.id}"`)}</div>`:''}</div></article>`;}).join('')||empty('This collection is ready for your resources','Add readings, videos, and assignment references without moving the originals.',button('Find resources','pick-resources',`data-id="${c.id}"`,'primary'))}</div>
      ${canEdit?`<div class="bottom-actions"><p class="muted small">Removing a reference leaves the original resource and your notes intact.</p>${button('Delete collection','delete-collection',`data-id="${c.id}"`,'danger')}</div>`:''}`;
  }
  function noteCard(n) {
    const r=resource(n.resourceId), section=r.sections.find(s=>s.id===n.sectionId);
    const timestamp=/^At (\d+):(\d{2})\n/.exec(n.text), target={id:r.id,...(n.sectionId?{section:n.sectionId}:{}),...(timestamp?{time:String(Number(timestamp[1])*60+Number(timestamp[2]))}:{})};
    return `<article class="note-card"><div class="resource-top">${badge(r.type)}<span class="small muted">${e(new Date(n.updatedAt).toLocaleDateString())}</span></div><h3>${e(r.title)}</h3><small>${e(section?.title||'Resource note')}</small><p class="note-text">${e(n.text)}</p><div class="actions">${link('Return to resource','study',target)}${button('Edit','edit-note',`data-id="${n.id}"`)}${button('Delete','delete-note',`data-id="${n.id}"`,'link-button')}</div></article>`;
  }
  function notesView() {
    $('main').innerHTML=title('My Notes','One set of notes for each resource, wherever you find it.',button('Export notes','export-notes',state().notes.length?'':'disabled'))
      + `<label class="note-filter">Find a note<input id="note-filter" type="search" placeholder="Search your notes or resource titles"></label><div id="note-results" class="notes-grid">${state().notes.map(noteCard).join('')||empty('Your notes start here','Open a resource and add a note to a reading section or video moment.',link('Explore resources','explore',{},'button primary'))}</div>`;
  }
  function progressView() {
    const entries=Object.entries(state().progress).sort((a,b)=>b[1].updatedAt.localeCompare(a[1].updatedAt));
    const reviewed=entries.filter(([,p])=>p.status==='reviewed').length;
    $('main').innerHTML=title('My Progress','Resume where you stopped. You decide when a resource is reviewed.')
      + `<div class="stats"><div><strong>${entries.length-reviewed}</strong><span>In progress</span></div><div><strong>${reviewed}</strong><span>Marked reviewed</span></div><div><strong>${state().resources.length-entries.length}</strong><span>Not started</span></div></div>
      <p class="callout">Personal study markers only. Opening a resource does not mark it reviewed or update Canvas completion.</p>
      <div class="progress-list">${entries.map(([id,p])=>{const r=resource(id);return `<article class="progress-item"><div class="grow"><h2>${e(r.title)}</h2><p>${e(r.type)} · ${e(r.sections.find(s=>s.id===p.sectionId)?.title||'Resource')}${r.type==='Video'?` · ${time(p.time)}`:''}</p></div>${badge(p.status==='reviewed'?'Reviewed':'In progress')}${link('Resume','study',{id},'button primary')}${button(p.status==='reviewed'?'Mark in progress':'Mark reviewed','status',`data-id="${id}" data-status="${p.status==='reviewed'?'in-progress':'reviewed'}"`)}</article>`;}).join('')||empty('No study activity yet','Open a resource to begin.',link('Begin with recognition and recall','study',{id:'youtube-recognition'},'button primary'))}</div>`;
  }
  function bodySections(r) {
    return r.sections.map(s=>`<section class="reading-section" id="section-${e(s.id)}" data-section="${e(s.id)}"><h2>${e(s.title)}</h2><p>${e(s.text)}</p><div class="section-actions">${button('+ Note here','note',`data-id="${r.id}" data-section="${s.id}"`)}${button('Resume here next time','bookmark-section',`data-id="${r.id}" data-section="${s.id}"`,'link-button')}</div></section>`).join('');
  }
  function isCourseReading(r) {
    if(!r.sourceUrl||!r.sectionLinks)return false;
    const url=new URL(r.sourceUrl);
    return url.hostname==='omscs6750.gatech.edu' && /^\/atlas\/lesson-[\d-]+\.html$/.test(url.pathname);
  }
  function readingContents(r) {
    if(isCourseReading(r)){
      return `<div class="source-reading-controls"><label>Course section<select id="source-section">${options(r.sections.map(s=>({value:s.id,label:s.title})),r.sections[0]?.id)}</select></label>${button('Read course lesson','load-reading','','primary')}${button('+ Note on this section','source-note')}</div><div id="reading-body" class="external-reading"><div id="reading-cover" class="source-reading-cover"><span class="eyebrow">CS6750 ATLAS</span><h2>${e(r.title)}</h2><p>${e(r.summary)}</p><p class="small muted">Read the original course page here, or open it in a separate tab.</p>${original(r)}</div><iframe id="source-reading-frame" title="${e(r.title)} — original course reading" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" hidden></iframe></div><p class="small muted source-resume">Your selected section is remembered. Scrolling inside the source page is not tracked.</p>`;
    }
    return `<nav class="section-index" aria-label="Reading sections">${r.sections.map(s=>`<a href="#section-${e(s.id)}" data-jump="${e(s.id)}">${e(s.title)}</a>`).join('')}</nav><div id="reading-body" tabindex="0" aria-label="Reading content">${bodySections(r)||(r.url?`<div class="source-reading-cover"><h2>${e(r.title)}</h2><p>${e(r.summary)}</p>${original(r)}${r.url.includes('gatech.instructure.com')?'<p class="small muted">Georgia Tech sign-in may be required. Canvas holds the current instructions and dates.</p>':''}</div>`:'<p class="callout">Download the attached document to read it.</p>')}</div>`;
  }
  function loadCourseReading() {
    if(!study||!isCourseReading(study.reading))throw new Error('No course reading is selected.');
    const section=$('source-section').value;
    const url=study.reading.sectionLinks[section];
    if(!url)throw new Error('The selected source section is unavailable.');
    $('source-reading-frame').src=url;
    $('source-reading-frame').hidden=false;
    $('reading-cover').hidden=true;
    store.setProgress(study.reading.id,{sectionId:section});
  }
  function fileLink(r) {
    if(!r.file)return '';
    const parts=r.file.dataUrl.split(','), base64=parts[0].includes(';base64');
    const bytes=base64?Uint8Array.from(atob(parts[1]),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(parts[1]));
    const url=URL.createObjectURL(new Blob([bytes],{type:r.file.mime}));blobUrls.push(url);
    return `<a class="button" href="${url}" download="${e(r.file.name)}">Download ${e(r.file.name)}</a>`;
  }
  function studyView(params) {
    const r=resource(params.get('id')); if(!r)throw new Error('Resource not found.');
    const related=r.relatedIds.map(resource), relatedVideo=related.find(v=>v.type==='Video'&&youtubeId(v.url))||related.find(v=>v.type==='Video');
    const video=r.type==='Video'?r:relatedVideo;
    let reading=r.type==='Video'?related.find(v=>v.type==='Reading'):r;
    const requestedReading=resource(params.get('reading')); if(requestedReading?.type==='Reading')reading=requestedReading;
    if(!reading)reading=r;
    const from=collection(params.get('from'));
    const context=state().collections.filter(c=>c.resourceIds.includes(r.id));
    const explicitTime=params.has('time')?Number(params.get('time')):null;
    if(explicitTime!==null&&(!Number.isFinite(explicitTime)||explicitTime<0||explicitTime>86400))throw new Error('Invalid video timestamp.');
    const initialSection=params.get('section')||state().progress[reading.id]?.sectionId||(r.id==='youtube-recognition'&&reading.id==='atlas-2-4'?'s12':reading.sections[0]?.id);
    perform(()=>store.setProgress(r.id,{}));
    if(reading.id!==r.id)perform(()=>store.setProgress(reading.id,{}));
    $('main').innerHTML=title(r.title,`${r.source}${r.sourceUrl?'':' · '+r.version}`,`${from?link('← '+from.title,'collection',{id:from.id}):link('← Explore','explore')}${button('+ Collect','collect',`data-id="${r.id}"`)}${instructor()&&!r.sourceUrl?button('Edit resource','edit-resource',`data-id="${r.id}"`):''}`)
      + `${r.status==='superseded'?'<p class="callout warning">Archived resource from the earlier design. It remains available because it is linked to your saved work.</p>':''}
      <div class="study-context">${badge(r.type)}${original(r)}<span class="small muted">Also in:</span>${context.map(c=>link(c.title,'collection',{id:c.id},'text-link')).join('')}</div>
      ${video?`<div class="study-controls"><div class="segmented" aria-label="Study layout">${button('Side by side','layout','data-layout="split"')}${button('Continuous','layout','data-layout="continuous"')}</div><label class="reading-select">Associated reading<select id="reading-select">${options(activeResources().filter(item=>item.type==='Reading').map(item=>({value:item.id,label:item.title})),reading.type==='Reading'?reading.id:'','Choose a reading')}</select></label></div>`:''}
      <div id="study-layout" class="study-layout ${video?'with-video':'reading-only'}">
      ${video?`<section class="video-pane"><div class="panel-heading"><h2>${youtubeId(video.url)?'YouTube video':'Archived video'}</h2>${original(video)}</div><h3>${e(video.title)}</h3>
        <div id="video-host">${youtubeId(video.url)?`<div class="video-consent"><span class="play-symbol" aria-hidden="true">▷</span><h3>Ready when you are</h3><p>Load the YouTube player to watch alongside the course reading.</p>${button('Load YouTube video','load-youtube','','primary')}<a href="${e(video.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></div>`:'<p class="callout">This earlier video is no longer included. Your saved notes and timestamps are retained.</p>'}</div>
        <p id="player-status" class="player-status" role="status">${youtubeId(video.url)?'YouTube loads on request. Its access and privacy terms apply.':'Archived study record'}</p>
        <div class="seek-row"><label>Jump to time<input id="seek-input" placeholder="0:00" value="${time(explicitTime??state().progress[video.id]?.time??0)}" inputmode="numeric"></label>${button('Go','seek')}${button('+ Note at this time','video-note')}</div>
        <p class="small muted">Captions, when available, can be enabled in the video player.</p>
      </section><div id="study-divider" class="study-divider" role="separator" aria-label="Resize video and reading" aria-orientation="vertical" aria-valuemin="35" aria-valuemax="60" tabindex="0"><span>⋮</span></div>`:''}
      <section class="reading-pane"><div class="panel-heading"><h2 id="reading-title">${e(reading.title)}</h2>${reading.sourceUrl?'':badge(reading.version)}</div><div class="reading-source">${e(reading.source)} ${original(reading)}</div>${fileLink(reading)}
        ${readingContents(reading)}
        <div class="reading-footer">${button(state().progress[reading.id]?.status==='reviewed'?'Mark in progress':'Mark reviewed','review-reading',`data-id="${reading.id}"`)}${button('+ Resource note','note',`data-id="${reading.id}"`)}</div>
      </section></div>
      <div class="study-bottom"><section><div class="section-heading"><h2>Notes for this resource</h2>${link('All notes →','notes',{},'text-link')}</div><div id="study-notes"></div></section>
      <section><h2>Related resources</h2><div class="related-list">${related.map(item=>link(item.title,'study',{id:item.id,...(from?{from:from.id}:{})},'related-link')).join('')}</div></section></div>`;
    study={resource:r,video,reading,from,player:null,ready:false,played:false,poll:null,observer:null,debounce:null,cleanup:null,startTime:explicitTime??state().progress[video?.id]?.time??0,lastSavedTime:-1};
    applyLayout();
    attachStudy();
    if(initialSection)requestAnimationFrame(()=>jumpSection(initialSection,false));
    renderStudyNotes();
  }
  function renderStudyNotes() {
    if(!study||!$('study-notes'))return;
    const ids=new Set([study.resource.id,study.reading.id,study.video?.id]);
    const notes=state().notes.filter(n=>ids.has(n.resourceId));
    $('study-notes').innerHTML=notes.map(noteCard).join('')||'<p class="muted">No notes yet. Add one beside a section or at a video moment.</p>';
  }
  function applyLayout(ratio=state().prefs.ratio) {
    if(!$('study-layout'))return;
    const split=state().prefs.layout==='split'&&innerWidth>=1000&&study?.video;
    $('study-layout').classList.toggle('split',Boolean(split));
    $('study-layout').style.setProperty('--video-share',`${ratio}fr`);
    $('study-layout').style.setProperty('--reading-share',`${100-ratio}fr`);
    const divider=$('study-divider');
    if(divider){divider.hidden=!split;divider.setAttribute('aria-valuenow',String(ratio));divider.setAttribute('aria-valuetext',`${ratio}% video, ${100-ratio}% reading`);}
    document.querySelectorAll('[data-layout]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.layout===(split?'split':'continuous')));b.disabled=b.dataset.layout==='split'&&innerWidth<1000;});
  }
  function playbackTime() { return study?.player&&study.ready&&study.played?study.player.getCurrentTime():$('local-video')?.currentTime??study?.startTime??0; }
  function savePlayback(force=false) {
    if(!study?.video)return;
    if(study.player&&!study.played)return;
    const seconds=playbackTime();
    if(!Number.isFinite(seconds)||seconds<0)return;
    if(!force&&Math.abs(seconds-study.lastSavedTime)<2)return;
    const outcome=perform(()=>store.setProgress(study.video.id,{time:seconds}));
    if(outcome.ok)study.lastSavedTime=seconds;
    else if(study.poll){clearInterval(study.poll);study.poll=null;}
  }
  function attachStudy() {
    const captured=study, local=$('local-video'), divider=$('study-divider'), reader=$('reading-body');
    if(local){
      local.addEventListener('loadedmetadata',()=>{if(study===captured&&captured.startTime<local.duration)local.currentTime=captured.startTime;});
      local.addEventListener('timeupdate',()=>savePlayback());
      local.addEventListener('pause',()=>savePlayback(true));
      local.addEventListener('error',()=>{if($('player-status'))$('player-status').textContent='The local video could not load. The original transcript below remains available.';});
    }
    let pointer=null, ratio=state().prefs.ratio;
    if(divider){
      divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointer=event.pointerId;divider.setPointerCapture(pointer);event.preventDefault();});
      divider.addEventListener('pointermove',event=>{if(event.pointerId!==pointer)return;const rect=$('study-layout').getBoundingClientRect();ratio=Math.round(Math.max(35,Math.min(60,100*(event.clientX-rect.left)/rect.width)));applyLayout(ratio);});
      const finish=()=>{if(pointer===null)return;pointer=null;perform(()=>store.setPrefs({ratio}));};
      ['pointerup','pointercancel','lostpointercapture'].forEach(name=>divider.addEventListener(name,finish));
      divider.addEventListener('keydown',event=>{const values={ArrowLeft:state().prefs.ratio-2,ArrowRight:state().prefs.ratio+2,Home:35,End:60};if(!(event.key in values))return;event.preventDefault();ratio=Math.max(35,Math.min(60,values[event.key]));perform(()=>store.setPrefs({ratio}));applyLayout();});
    }
    reader.addEventListener('scroll',()=>{
      clearTimeout(captured.debounce);
      captured.debounce=setTimeout(()=>{
        if(study!==captured)return;
        const top=reader.getBoundingClientRect().top;
        const sections=[...reader.querySelectorAll('[data-section]')];
        const active=sections.find(s=>s.getBoundingClientRect().bottom>top+40);
        if(active)perform(()=>store.setProgress(captured.reading.id,{sectionId:active.dataset.section}));
      },350);
    },{passive:true});
  }
  function jumpSection(id,save=true) {
    if($('source-section')){
      if(!study.reading.sections.some(s=>s.id===id))return;
      $('source-section').value=id;
      if(!$('source-reading-frame').hidden)loadCourseReading();
      else if(save)perform(()=>store.setProgress(study.reading.id,{sectionId:id}));
      return;
    }
    const node=$('section-'+id), reader=$('reading-body');if(!node||!reader)return;
    reader.scrollTo({top:reader.scrollTop+node.getBoundingClientRect().top-reader.getBoundingClientRect().top,behavior:'instant'});
    if(save&&study)perform(()=>store.setProgress(study.reading.id,{sectionId:id}));
  }
  function loadYoutubeAPI() {
    if(window.YT?.Player)return Promise.resolve();
    if(ytPromise)return ytPromise;
    ytPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>{ytPromise=null;script.remove();reject(new Error('YouTube did not respond. Open the original video or try again.'));},15000);
      window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};
      script.onerror=()=>{clearTimeout(timer);script.remove();ytPromise=null;reject(new Error('YouTube could not be reached. Open the original video.'));};
      script.src='https://www.youtube.com/iframe_api';document.head.append(script);
    });
    return ytPromise;
  }
  async function loadYoutube() {
    const captured=study;if(!captured?.video)return;
    const load=document.querySelector('[data-action="load-youtube"]');if(load)load.disabled=true;
    $('player-status').textContent='Connecting to YouTube…';
    try{
      await loadYoutubeAPI();if(study!==captured)return;
      $('video-host').innerHTML='<div id="youtube-player"></div>';
      captured.player=new window.YT.Player('youtube-player',{host:'https://www.youtube-nocookie.com',videoId:youtubeId(captured.video.url),playerVars:{playsinline:1,start:Math.floor(captured.startTime),rel:0,...(location.protocol.startsWith('http')?{origin:location.origin}:{})},events:{
        onReady:()=>{if(study!==captured)return;captured.ready=true;$('player-status').textContent='YouTube player ready. Play to begin; your position is saved locally.';captured.poll=setInterval(()=>savePlayback(),2500);},
        onStateChange:event=>{if(study!==captured)return;if(event.data===1)captured.played=true;if(event.data===2||event.data===0)savePlayback(true);},
        onError:event=>{if(study!==captured)return;captured.ready=false;clearInterval(captured.poll);$('player-status').textContent=`YouTube cannot play this video here (code ${event.data}). It may require sign-in or disallow embedding. Use the original YouTube link above.`;}
      }});
    }catch(error){if(study===captured){$('player-status').textContent=error.message;if(load?.isConnected)load.disabled=false;}notice(error.message);}
  }
  function seek(seconds) {
    if(!study?.video)throw new Error('No video is selected.');
    const local=$('local-video'), duration=study.ready?study.player.getDuration():local?.duration;
    if(!Number.isFinite(seconds)||seconds<0||(Number.isFinite(duration)&&duration>0&&seconds>duration))throw new Error('Enter a time within the video duration.');
    study.startTime=seconds;
    if(study.ready){study.player.seekTo(seconds,true);study.played=true;}
    else if(local?.readyState>=1)local.currentTime=seconds;
    else notice('Timestamp saved. Load the player to seek to this position.');
    store.setProgress(study.video.id,{time:seconds});$('seek-input').value=time(seconds);
  }
  function cleanupStudy() {
    if(!study)return;
    if(study.ready||$('local-video')?.readyState>=1)savePlayback(true);
    clearInterval(study.poll);clearTimeout(study.debounce);study.observer?.disconnect();
    $('local-video')?.pause();study.player?.destroy();study=null;
    blobUrls.forEach(url=>URL.revokeObjectURL(url));blobUrls=[];
  }
  function render() {
    cleanupStudy();const {page,params}=route();currentRoute=page;
    $('dialog').open&&closeModal();
    document.querySelectorAll('[data-page]').forEach(a=>{const active=a.dataset.page===(page==='collection'?'collections':page);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    try{
      if(page==='home')home();
      else if(page==='explore')explore(params);
      else if(page==='collections')collections(params);
      else if(page==='collection')collectionView(params);
      else if(page==='study')studyView(params);
      else if(page==='notes')notesView();
      else if(page==='progress')progressView();
      else throw new Error('That page is not available.');
    }catch(error){$('main').innerHTML=empty('Unable to open this page',error.message,link('Return home','home',{},'button primary'));}
    status();window.scrollTo({top:0,behavior:'instant'});$('main').focus({preventScroll:true});
  }
  function collectionForm(id) {
    const c=id?collection(id):null;if(id&&!c)throw new Error('Collection not found.');
    modal(c?'Edit collection':'Create a collection',`<form>${field('Collection name','title',c?.title||'','required maxlength="120"') }<label>Description<textarea name="description" rows="3" maxlength="600">${e(c?.description)}</textarea></label>${!c&&instructor()?`<label>Collection type<select name="kind">${options(['personal','course'],'personal')}</select></label>`:''}<p class="small muted">Resources remain in the common library; collections hold references.</p>${formActions(c?'Save changes':'Create collection')}</form>`,form=>{
      const data=new FormData(form);const outcome=perform(()=>c?(store.updateCollection(c.id,{title:data.get('title'),description:data.get('description')}),c.id):store.createCollection({title:data.get('title'),description:data.get('description'),kind:data.get('kind')||'personal'}),'Collection saved');
      if(outcome.ok){closeModal();go('collection',{id:outcome.result});}
    });
  }
  function collect(id) {
    const r=resource(id);if(!r)throw new Error('Resource not found.');
    const choices=state().collections.filter(c=>editable(c)&&!c.resourceIds.includes(id));
    modal('Add to collection',`<p><strong>${e(r.title)}</strong></p><p class="muted">Add a reference, not a duplicate. Notes and progress stay with the resource.</p>${choices.length?`<form><label>Collection<select name="collection">${options(choices.map(c=>({value:c.id,label:c.title+(c.kind==='course'?' · Course':'' )})))}</select></label>${formActions('Add resource')}</form>`:'<p>No other editable collections are available.</p>'}${button('+ Create a new collection','new-collection')}`,form=>{
      const idc=new FormData(form).get('collection');const outcome=perform(()=>store.addToCollection(idc,id),'Resource added');if(outcome.ok){closeModal();if(currentRoute==='collection')render();}
    });
  }
  function pickResources(id) {
    const c=collection(id);if(!c)throw new Error('Collection not found.');
    const candidates=state().resources.filter(r=>!c.resourceIds.includes(r.id)&&r.status!=='superseded');
    modal('Add existing resources',`<p>Link resources from the shared library into <strong>${e(c.title)}</strong>.</p><div class="picker-list">${candidates.map(r=>`<div><div><strong>${e(r.title)}</strong><small>${e(r.type)} · ${e(r.lesson)}</small></div>${button('Add','picker-add',`data-id="${r.id}" data-collection="${c.id}"`)}</div>`).join('')||'<p>All current resources are already in this collection.</p>'}</div>`);
  }
  function noteForm(resourceId,sectionId='',noteId='',at=null) {
    const note=state().notes.find(n=>n.id===noteId),r=resource(note?.resourceId||resourceId);
    if(!r)throw new Error('Resource not found.');
    const text=note?.text??(at!==null?`At ${time(at)}\n`:'');
    modal(note?'Edit note':'Add a note',`<p><strong>${e(r.title)}</strong></p><p class="small muted">${e(r.sections.find(s=>s.id===(note?.sectionId||sectionId))?.title||'Resource note')} · Private on this device</p><form><label>Note<textarea name="text" rows="6" required maxlength="6000">${e(text)}</textarea></label>${formActions('Save note')}</form>`,form=>{
      const text=new FormData(form).get('text');const outcome=perform(()=>note?store.updateNote(note.id,text):store.addNote({resourceId:r.id,sectionId,text}),'Note saved');
      if(outcome.ok){closeModal();if(study)renderStudyNotes();else render();}
    });
  }
  function account() {
    modal('Your account',`<form>${field('Display name','name',state().profile.name,'required maxlength="80"')}<label>View as<select name="role">${options([{value:'student',label:'Student'},{value:'instructor',label:'Course editor'}],state().profile.role)}</select></label><p class="small muted">Local preferences only. This does not sign you in to Georgia Tech or change course permissions.</p>${formActions('Save preferences')}</form><hr><div class="actions">${button('Export local data','export-data')}${button('Reset local data','reset','','danger')}</div><p class="small muted">Your saved notes and uploaded files are stored on this device.</p>`,form=>{
      const data=new FormData(form),outcome=perform(()=>store.setProfile({name:data.get('name'),role:data.get('role')}),'Preferences saved');
      if(outcome.ok){closeModal();render();}
    });
  }
  async function readUpload(file) {
    if(file.size>1024*1024)throw new Error('Choose a file up to 1 MB.');
    const mime=file.name.toLowerCase().endsWith('.pdf')?'application/pdf':file.name.toLowerCase().endsWith('.txt')?'text/plain':'';
    if(!mime)throw new Error('Only PDF and plain-text (.txt) documents are supported.');
    if(mime==='application/pdf'&&!(await file.slice(0,5).text()).startsWith('%PDF-'))throw new Error('This file does not have a PDF signature.');
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The selected file could not be read.'));reader.readAsDataURL(new Blob([file],{type:mime}));});
    return {file:{name:file.name,mime,dataUrl},text:mime==='text/plain'?await file.text():''};
  }
  function resourceForm(id) {
    if(!instructor())throw new Error('Switch to Course editor in Account to manage this local library.');
    const r=id?resource(id):null;if(id&&!r)throw new Error('Resource not found.');
    if(r?.sourceUrl)throw new Error('This resource is maintained at its published source. You can add a separate local resource instead.');
    modal(r?'Edit library resource':'Add a library resource',`<p class="small muted">Changes are saved on this device. Original Canvas and ATLAS pages are not modified.</p><form id="resource-form">${field('Title','title',r?.title||'','required maxlength="120"')}${!r?`<div class="form-grid"><label>Type<select name="type">${options(['Reading','Video','Assignment','Discussion','Reference'],'Reading')}</select></label>${field('Lesson','lesson','','required maxlength="120"')}</div>${field('Concepts (comma-separated)','concepts','','required maxlength="300"')}`:''}<label>Summary<textarea name="summary" rows="2" maxlength="2400">${e(r?.summary)}</textarea></label>${field('Original source URL (optional; HTTPS)','url',r?.url||'','type="url" placeholder="https://www.youtube.com/watch?v=…"')}<p class="small muted">For a YouTube video, choose Video and paste its public URL.</p>${r?r.sections.map(s=>`<label>${e(s.title)}<textarea data-section-id="${s.id}" data-section-title="${e(s.title)}" rows="3" maxlength="150000">${e(s.text)}</textarea></label>`).join(''):`<label>Reading or resource text<textarea name="content" rows="5" maxlength="150000"></textarea></label>`}<label>${r?'Replace attached file (optional)':'Attach a document (optional)'}<input type="file" name="file" accept=".txt,.pdf"></label><p class="small muted">PDF or plain text, up to 1 MB. Add only material you are allowed to use. PDF text is not searched; its metadata is.</p>${formActions(r?'Save new version':'Add to library')}</form>`,async form=>{
      const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
      try{
        const data=new FormData(form),file=data.get('file'),uploaded=file?.size?await readUpload(file):null;
        let changes={title:String(data.get('title')),summary:String(data.get('summary')),url:String(data.get('url'))};
        if(uploaded)changes.file=uploaded.file;
        if(r){
          changes.sections=[...form.querySelectorAll('[data-section-id]')].map(node=>({id:node.dataset.sectionId,title:node.dataset.sectionTitle,text:node.value}));
          if(uploaded?.text)changes.sections.push({id:`imported-${Date.now()}`,title:uploaded.file.name,text:uploaded.text});
        }else{
          const text=uploaded?.text||String(data.get('content'));
          changes={...changes,type:String(data.get('type')),source:'Course library · added on this device',lesson:String(data.get('lesson')),concepts:unique(String(data.get('concepts')).split(',').map(s=>s.trim()).filter(Boolean)),sections:text?[{id:'resource-content',title:'Resource content',text}]:[]};
          if(!text&&!changes.url&&!uploaded)throw new Error('Add text, a file, or an original-source URL.');
          if(changes.type==='Video'&&!youtubeId(changes.url))throw new Error('For a video, enter a valid public YouTube URL.');
        }
        const outcome=perform(()=>r?(store.updateResource(r.id,changes),r.id):store.addResource(changes),'Resource saved');
        if(outcome.ok){closeModal();go('study',{id:outcome.result});}
      }catch(error){$('dialog-error').textContent=error.message;notice(error.message);}
      finally{if(submit.isConnected)submit.disabled=false;}
    });
  }
  function exportCollection(id) {
    const c=collection(id);if(!c)throw new Error('Collection not found.');
    const text=[c.title,c.description,'','Resource metadata, locally added text, and original-source links. Personal notes are not included; external pages and media are not downloaded.','',...c.resourceIds.flatMap(id=>{const r=resource(id);return [r.title,`Source: ${r.source}`,r.url||'',`In this collection: ${c.requirements[id]||'Unspecified'}`,...r.sections.flatMap(s=>['',s.title,s.text,r.sectionLinks?.[s.id]||'']),''];})].join('\n');
    download('course-collection.txt',text);notice('Collection exported. No external content was downloaded.');
  }
  document.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target;
    if(form.closest('#dialog')){if(dialogSubmit)await dialogSubmit(form);return;}
    if(form.id==='home-search'){go('explore',{q:new FormData(form).get('q')});return;}
    if(form.id==='search-form'){
      const data=new FormData(form),values={};for(const [key,value]of data)if(value)values[key]=key==='older'?'1':String(value);
      history.replaceState(null,'',href('explore',values));searchResults();
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.closest('#search-form'))searchResults();
    if(event.target.id==='note-filter'){
      const query=event.target.value.toLowerCase().trim();const notes=state().notes.filter(n=>(n.text+' '+resource(n.resourceId).title).toLowerCase().includes(query));
      $('note-results').innerHTML=notes.map(noteCard).join('')||empty('No matching notes','Try a different word.');
    }
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target.closest('#search-form'))searchResults();
    if(target.dataset.requirement)perform(()=>store.setRequirement(target.dataset.collection,target.dataset.requirement,target.value),'Requirement updated');
    if(target.id==='reading-select'&&target.value&&study){const params=Object.fromEntries(route().params);go('study',{...params,reading:target.value});}
    if(target.id==='source-section')perform(()=>jumpSection(target.value));
  });
  document.addEventListener('click',event=>{
    const jump=event.target.closest('[data-jump]');
    if(jump){event.preventDefault();jumpSection(jump.dataset.jump);return;}
    const target=event.target.closest('[data-action]');if(!target)return;
    const a=target.dataset.action,id=target.dataset.id,cid=target.dataset.collection;
    perform(()=>{
      if(a==='account')account();
      else if(a==='close-dialog')closeModal();
      else if(a==='about')modal('About this experience','<p>A student-designed course-navigation prototype, not an official Georgia Tech service. The catalog uses the 27 published CS6750 ATLAS lessons and links to the current course’s Canvas and Ed pages. The related NN/g YouTube video is supplemental, not an official CS6750 lecture.</p><p>Course collections follow the published unit structure. Requirement labels and Fall 2026 deadlines are not inferred from older semester pages; check Canvas for authoritative instructions. Full readings load from their original public source only when requested. No lecture transcripts or reading PDFs are bundled.</p><p>Course-editor actions, notes, progress, and uploads stay in this browser. There is no live Canvas integration or real authentication. The Georgia Tech palette is used for this coursework prototype without implying institutional endorsement.</p><p>Use Account → Export local data before clearing browser storage.</p>');
      else if(a==='new-collection')collectionForm();
      else if(a==='edit-collection')collectionForm(id);
      else if(a==='delete-collection')confirmAction('Delete collection?','This removes the collection, not its resources, notes, or progress.',()=>{store.deleteCollection(id);go('collections',{kind:'personal'});});
      else if(a==='collect')collect(id);
      else if(a==='pick-resources')pickResources(id);
      else if(a==='picker-add'){store.addToCollection(cid,id);target.disabled=true;target.textContent='Added';notice('Resource linked to collection.');}
      else if(a==='move'){store.moveResource(cid,id,Number(target.dataset.direction));render();}
      else if(a==='remove-reference'){store.removeFromCollection(cid,id);render();notice('Reference removed. Original resource and notes kept.');}
      else if(a==='note')noteForm(id,target.dataset.section||'');
      else if(a==='edit-note')noteForm(null,'',id);
      else if(a==='delete-note')confirmAction('Delete note?','This permanently removes the selected note from this prototype.',()=>store.deleteNote(id));
      else if(a==='status'){store.setProgress(id,{status:target.dataset.status});render();}
      else if(a==='review-reading'){const reviewed=state().progress[id]?.status==='reviewed';store.setProgress(id,{status:reviewed?'in-progress':'reviewed'});target.textContent=reviewed?'Mark reviewed':'Mark in progress';notice(reviewed?'Marked in progress.':'Marked reviewed by you.');}
      else if(a==='bookmark-section'){store.setProgress(id,{sectionId:target.dataset.section});notice('Resume position saved.');}
      else if(a==='layout'){store.setPrefs({layout:target.dataset.layout});applyLayout();}
      else if(a==='load-youtube')loadYoutube();
      else if(a==='load-reading')loadCourseReading();
      else if(a==='source-note')noteForm(study.reading.id,$('source-section').value);
      else if(a==='chapter')seek(Number(target.dataset.time));
      else if(a==='seek'){const match=/^(\d{1,4}):([0-5]\d)$/.exec($('seek-input').value.trim());if(!match)throw new Error('Enter time as minutes:seconds, such as 1:30.');seek(Number(match[1])*60+Number(match[2]));}
      else if(a==='video-note')noteForm(study.video.id,'','',playbackTime());
      else if(a==='new-resource')resourceForm();
      else if(a==='edit-resource')resourceForm(id);
      else if(a==='export-collection')exportCollection(id);
      else if(a==='export-notes'){download('my-course-notes.txt',state().notes.map(n=>`${resource(n.resourceId).title}\n${n.text}\n`).join('\n'));notice('Notes exported.');}
      else if(a==='export-data')download('information-center-data.json',store.exportData(),'application/json');
      else if(a==='reset')confirmAction('Reset local prototype data?','This deletes this prototype’s personal collections, notes, progress, and uploads on this device. Export your data first if you need to keep it.',()=>{cleanupStudy();store.reset();$('warning').hidden=true;go('home');});
    });
  });
  $('dialog').addEventListener('close',()=>{dialogSubmit=null;if(currentRoute==='collection'&&$('main').querySelector('.collection-resources'))collectionView(route().params);});
  window.addEventListener('hashchange',render);
  window.addEventListener('resize',()=>applyLayout());
  window.addEventListener('pagehide',()=>savePlayback(true));
  window.addEventListener('storage',event=>{if(event.key===window.CenterModel.STORAGE_KEY){$('warning').textContent='This prototype was updated in another tab. Reload before editing so you do not overwrite newer changes.';$('warning').hidden=false;}});
  render();
})();
