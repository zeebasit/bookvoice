/* BookVoice: local-only personal book reader. The web speech engine runs on the device. */
'use strict';

const $ = (id) => document.getElementById(id);
const el = {
  file: $('fileInput'), add: $('importButton'), addMore: $('addMoreButton'), sample: $('sampleButton'),
  list: $('libraryList'), empty: $('libraryEmpty'), count: $('bookCount'),
  player: $('playerSection'), title: $('currentTitle'), format: $('currentFormat'),
  status: $('readingStatus'), progress: $('progressLabel'), remaining: $('remainingLabel'),
  slider: $('seekSlider'), play: $('playButton'), back: $('backButton'), forward: $('forwardButton'),
  voice: $('voiceSelect'), speed: $('speedSelect'), excerpt: $('bookExcerpt'), toast: $('toast')
};

const DB_NAME = 'bookvoice-local-v1';
const STORE_NAME = 'books';
let db;
let library = [];
let active = null;
let chunks = [];
let speaking = false;
let paused = false;
let generation = 0;
let selectedVoice = localStorage.getItem('bookvoice-voice') || '';
let speed = Number(localStorage.getItem('bookvoice-speed')) || 1;
let toastTimer = null;
let saveTimer = null;

function notify(message, error = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', !!error);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 5200);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('This browser does not support local book storage.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeAction(mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = operation(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Book storage failed'));
    tx.onerror = () => reject(tx.error || new Error('Book storage failed'));
  });
}

const readAll = () => storeAction('readonly', store => store.getAll());
const saveBook = book => storeAction('readwrite', store => store.put(book));
const deleteBook = id => storeAction('readwrite', store => store.delete(id));
function newId() { return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function prettyPercent(book) { return Math.min(100, Math.max(0, Math.round(100 * (book.position || 0) / Math.max(1, book.text.length)))); }
function shortTitle(filename) { return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); }

async function refreshLibrary() {
  library = (await readAll()).sort((a, b) => (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0));
  el.count.textContent = library.length ? `(${library.length})` : '';
  el.empty.hidden = library.length > 0;
  el.list.replaceChildren();
  for (const book of library) {
    const tile = document.createElement('article');
    tile.className = 'book-tile' + (book.id === active?.id ? ' selected' : '');
    const header = document.createElement('div'); header.className = 'tile-top';
    const icon = document.createElement('div'); icon.className = `tile-icon ${book.format.toLowerCase()}`; icon.textContent = '◈'; icon.setAttribute('aria-hidden', 'true');
    const format = document.createElement('span'); format.className = 'tile-format'; format.textContent = book.format;
    header.append(icon, format);
    const name = document.createElement('h3'); name.className = 'tile-name'; name.textContent = book.title;
    const percentage = document.createElement('p'); percentage.className = 'tile-progress-label'; percentage.textContent = `${prettyPercent(book)}% complete`;
    const track = document.createElement('div'); track.className = 'progress-track';
    const bar = document.createElement('div'); bar.className = 'progress-bar'; bar.style.width = `${prettyPercent(book)}%`;
    track.append(bar);
    const actions = document.createElement('div'); actions.className = 'tile-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'tile-open';
    open.textContent = book.position ? 'Continue →' : 'Listen →'; open.addEventListener('click', () => loadBook(book.id, true));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tile-delete'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${book.title}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove “${book.title}” from BookVoice? Your original file will not be deleted.`)) return;
      if (active?.id === book.id) { stopSpeaking(); active = null; chunks = []; el.player.hidden = true; localStorage.removeItem('bookvoice-last'); }
      try { await deleteBook(book.id); await refreshLibrary(); notify('Book removed from this device.'); }
      catch (err) { notify(err.message, true); }
    });
    actions.append(open, remove); tile.append(header, name, percentage, track, actions); el.list.append(tile);
  }
}

/* Split text into short, stable chunks. Short utterances work more reliably in Safari. */
function chunkText(text) {
  const result = [];
  let start = 0;
  const maxChars = 230;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (start >= text.length) break;
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      let best = -1;
      for (let i = start + 95; i < end; i++) {
        if (/[.!?。！？\n]/.test(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1]))) best = i + 1;
      }
      if (best < 0) {
        for (let i = end - 1; i >= start + 100; i--) {
          if (/\s/.test(text[i])) { best = i; break; }
        }
      }
      if (best > 0) end = best;
    }
    const value = text.slice(start, end).trim();
    if (value) result.push({ start, end, text: value });
    start = end;
  }
  return result;
}

function chunkIndexAt(position) {
  if (!chunks.length) return 0;
  let low = 0, high = chunks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (chunks[mid].end <= position) low = mid + 1;
    else if (chunks[mid].start > position) high = mid - 1;
    else return mid;
  }
  return Math.min(low, chunks.length - 1);
}

async function loadBook(id, scroll = false) {
  const book = library.find(item => item.id === id) || await storeAction('readonly', store => store.get(id));
  if (!book) return;
  stopSpeaking();
  active = book;
  active.lastOpened = Date.now();
  chunks = chunkText(book.text);
  el.title.textContent = book.title;
  el.format.textContent = book.format;
  el.player.hidden = false;
  localStorage.setItem('bookvoice-last', id);
  renderPlayer();
  await saveBook(active);
  await refreshLibrary();
  if (scroll) el.player.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPlayer() {
  if (!active) return;
  const percent = prettyPercent(active);
  el.progress.textContent = `${percent}% complete`;
  el.slider.value = Math.round(1000 * (active.position || 0) / Math.max(1, active.text.length));
  const wordsLeft = (active.text.length - (active.position || 0)) / 6;
  const minutesLeft = Math.ceil(wordsLeft / (170 * speed));
  el.remaining.textContent = percent >= 100 ? 'Finished' : minutesLeft < 1 ? 'Less than 1 min left' : `≈ ${minutesLeft} min left`;
  el.status.textContent = paused ? 'Paused' : speaking ? 'Narrating…' : percent >= 100 ? 'Finished' : 'Ready to listen';
  el.play.textContent = (speaking && !paused) ? 'Ⅱ' : '▶';
  el.play.style.paddingLeft = (speaking && !paused) ? '0' : '4px';
  el.play.setAttribute('aria-label', (speaking && !paused) ? 'Pause book' : 'Play book');
  const index = chunkIndexAt(active.position || 0);
  el.excerpt.replaceChildren();
  if (!chunks.length) { el.excerpt.textContent = 'No readable text detected.'; return; }
  for (let i = Math.max(0, index - 1); i <= Math.min(chunks.length - 1, index + 2); i++) {
    const paragraph = document.createElement('div');
    paragraph.className = i === index ? 'excerpt-current' : i < index ? 'excerpt-before' : 'excerpt-after';
    paragraph.textContent = chunks[i].text;
    el.excerpt.append(paragraph);
  }
}

function stopSpeaking() {
  generation++;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  speaking = false;
  paused = false;
}
function persistProgress() {
  if (!active) return;
  const id = active.id;
  const position = active.position;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (active?.id !== id) return;
    saveBook({ ...active, position }).catch(err => notify(`Could not save progress: ${err.message}`, true));
  }, 250);
}

function getVoice() { return window.speechSynthesis.getVoices().find(voice => voice.voiceURI === selectedVoice) || null; }
function speakFromPosition() {
  if (!active || !chunks.length) return;
  if (!('speechSynthesis' in window)) { notify('Speech is not supported in this browser. Use Safari on an iPhone.', true); return; }
  if (active.position >= active.text.length) active.position = 0;
  stopSpeaking();
  speaking = true;
  const thisGeneration = generation;
  const sayNext = () => {
    if (generation !== thisGeneration || !active || !speaking) return;
    const index = chunkIndexAt(active.position);
    const segment = chunks[index];
    if (!segment || active.position >= active.text.length) {
      speaking = false;
      if (active) active.position = active.text.length;
      renderPlayer(); persistProgress(); refreshLibrary().catch(() => {});
      return;
    }
    active.position = segment.start;
    renderPlayer();
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.rate = speed;
    utterance.pitch = 1;
    const voice = getVoice();
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    else utterance.lang = active.lang || 'en-US';
    utterance.onend = () => {
      if (thisGeneration !== generation || !speaking) return;
      active.position = segment.end;
      persistProgress();
      // A short gap allows iOS Safari to drain each finished utterance.
      setTimeout(sayNext, 35);
    };
    utterance.onerror = event => {
      if (thisGeneration !== generation) return;
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      speaking = false;
      paused = false;
      renderPlayer();
      notify(`Narration stopped (${event.error || 'speech error'}). Tap Play to try again.`, true);
    };
    window.speechSynthesis.speak(utterance);
  };
  sayNext();
}
function togglePlayback() {
  if (!active) { notify('Import or select a book first.'); return; }
  if (!('speechSynthesis' in window)) return notify('Your browser does not support narration.', true);
  if (speaking && !paused) { window.speechSynthesis.pause(); paused = true; persistProgress(); renderPlayer(); return; }
  if (speaking && paused) { window.speechSynthesis.resume(); paused = false; renderPlayer(); return; }
  speakFromPosition();
}
function seekToFraction(fraction) {
  if (!active) return;
  const wasPlaying = speaking && !paused;
  stopSpeaking();
  const target = Math.round(Math.max(0, Math.min(1, fraction)) * active.text.length);
  active.position = target >= active.text.length ? active.text.length : chunks[chunkIndexAt(target)]?.start || 0;
  renderPlayer(); persistProgress();
  if (wasPlaying && active.position < active.text.length) speakFromPosition();
}
function skipSeconds(seconds) {
  if (!active) return;
  // Approximate narration time at 15 chars/second, adjusted for speed.
  const target = (active.position || 0) + seconds * 15 * speed;
  seekToFraction(target / Math.max(1, active.text.length));
}
function populateVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  el.voice.replaceChildren();
  const defaultOption = document.createElement('option'); defaultOption.value = ''; defaultOption.textContent = 'System default';
  el.voice.append(defaultOption);
  for (const voice of voices.sort((a,b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))) {
    const option = document.createElement('option'); option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${voice.localService ? '' : ' · online voice'}`;
    el.voice.append(option);
  }
  el.voice.value = voices.some(v => v.voiceURI === selectedVoice) ? selectedVoice : '';
}

/* HTML is parsed only to extract text, never inserted as untrusted markup. */
function extractHtmlText(rawHtml) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  for (const unwanted of doc.querySelectorAll('script,style,svg,nav,aside,iframe,noscript,form,head,footer')) unwanted.remove();
  const blockNames = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI','UL','OL','TABLE','TR','PRE','FIGCAPTION','BR','HR']);
  const pieces = [];
  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) { pieces.push(node.textContent); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (blockNames.has(node.nodeName)) pieces.push('\n');
    for (const child of node.childNodes) traverse(child);
    if (blockNames.has(node.nodeName)) pieces.push('\n');
  }
  traverse(doc.body);
  return pieces.join('').replace(/[ \t\u00a0]+/g,' ').replace(/\s*\n\s*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function xmlElements(parent, localName) {
  return Array.from(parent.getElementsByTagName('*')).filter(node => node.localName === localName);
}
function zipPath(baseFile, href) {
  // Resolve a package-relative link; external and absolute URLs are not book chapters.
  const cleanHref = href.split('#')[0].split('?')[0];
  const path = baseFile.split('/').slice(0,-1).concat(cleanHref.split('/'));
  const result = [];
  for (const part of path) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); }
  return result.join('/');
}
async function parseEpub(data, fallbackTitle) {
  if (!window.JSZip) throw new Error('EPUB reader library is unavailable. Connect to the internet and reload.');
  const archive = await JSZip.loadAsync(data);
  const containerFile = archive.file('META-INF/container.xml');
  if (!containerFile) throw new Error('This EPUB has no META-INF/container.xml.');
  const containerXml = new DOMParser().parseFromString(await containerFile.async('text'),'application/xml');
  const rootfile = xmlElements(containerXml,'rootfile')[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath || !archive.file(opfPath)) throw new Error('Could not find the EPUB package.');
  const opf = new DOMParser().parseFromString(await archive.file(opfPath).async('text'),'application/xml');
  const title = xmlElements(opf,'title')[0]?.textContent?.trim() || fallbackTitle;
  const lang = xmlElements(opf,'language')[0]?.textContent?.trim() || 'en-US';
  const manifest = new Map();
  const manifestNode = xmlElements(opf, 'manifest')[0];
  if (manifestNode) for (const item of xmlElements(manifestNode,'item')) manifest.set(item.getAttribute('id'), item);
  const spine = xmlElements(opf,'spine')[0];
  const chapters = [];
  if (spine) for (const itemref of xmlElements(spine,'itemref')) {
    if (itemref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(itemref.getAttribute('idref'));
    if (!item || !/xhtml|html/i.test(item.getAttribute('media-type') || '')) continue;
    const href = item.getAttribute('href') || '';
    const path = zipPath(opfPath, href);
    let entry = archive.file(path);
    if (!entry) { try { entry = archive.file(decodeURIComponent(path)); } catch {} }
    if (!entry) continue;
    const text = extractHtmlText(await entry.async('text'));
    if (text) chapters.push(text);
  }
  return { title, text: chapters.join('\n\n'), lang };
}
async function parsePdf(data, fallbackTitle) {
  if (!window.pdfjsLib) throw new Error('PDF reader library is unavailable. Connect to the internet and reload.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const documentHandle = await window.pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber++) {
      const page = await documentHandle.getPage(pageNumber);
      const content = await page.getTextContent();
      // Each PDF text element may be an individual word or fragment.
      let collected = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        collected += item.str;
        collected += item.hasEOL ? '\n' : ' ';
      }
      pages.push(collected.trim());
      if (pageNumber % 12 === 0) {
        notify(`Reading PDF: ${pageNumber} of ${documentHandle.numPages} pages`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const meta = await documentHandle.getMetadata().catch(() => null);
    const pdfTitle = meta?.info?.Title?.trim() || fallbackTitle;
    return { title: pdfTitle, text: pages.join('\n\n'), lang: 'en-US' };
  } finally { await documentHandle.destroy(); }
}
async function parseDocx(data, fallbackTitle) {
  if (!window.mammoth) throw new Error('Word reader library is unavailable. Connect to the internet and reload.');
  const response = await window.mammoth.extractRawText({ arrayBuffer: data });
  return { title: fallbackTitle, text: response.value, lang: 'en-US' };
}
async function parseFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  const title = shortTitle(file.name);
  const buffer = await file.arrayBuffer();
  let result;
  if (extension === 'epub') result = await parseEpub(buffer, title);
  else if (extension === 'pdf') result = await parsePdf(buffer, title);
  else if (extension === 'docx') result = await parseDocx(buffer, title);
  else if (extension === 'txt' || extension === 'md' || extension === 'markdown') result = { title, text: await file.text(), lang: 'en-US' };
  else if (extension === 'html' || extension === 'htm') result = { title, text: extractHtmlText(await file.text()), lang: 'en-US' };
  else throw new Error('Supported formats: PDF, EPUB, DOCX, TXT, MD and HTML.');
  const cleaned = result.text.replace(/\r\n?/g,'\n').replace(/[\t ]+/g,' ').replace(/\n{4,}/g,'\n\n\n').trim();
  if (cleaned.length < 10) throw new Error('No readable text found. Scanned or protected books are not supported.');
  return { id: newId(), title: result.title, format: extension.toUpperCase(), text: cleaned, lang: result.lang, position: 0, addedAt: Date.now(), lastOpened: Date.now() };
}
async function handleFiles(files) {
  const items = Array.from(files);
  if (!items.length) return;
  let imported = 0;
  let newestId = null;
  for (const file of items) {
    try {
      notify(`Importing “${file.name}”…`);
      const book = await parseFile(file);
      await saveBook(book);
      newestId = book.id;
      imported++;
    } catch (error) {
      console.error('Book import failed:', error);
      notify(`Could not import “${file.name}”: ${error.message}`, true);
      // Keep showing errors for single-file import; continue batch imports.
    }
  }
  await refreshLibrary();
  if (newestId) await loadBook(newestId, true);
  if (imported === items.length) notify(`${imported} ${imported === 1 ? 'book' : 'books'} added to your library.`);
  else if (imported) notify(`${imported} of ${items.length} books imported; check format of the others.`, true);
}

const sampleText = `Welcome to BookVoice. This is a short sample so you can hear how your iPhone reads your books aloud.\n\nBooks open doors to different worlds, even when you are doing something else. You can listen while walking through the park, making coffee, or relaxing at home.\n\nTap the pause button whenever you want to stop. Change the voice and the speed until it feels comfortable. Your progress will be saved so you can pick up where you left off.\n\nWhen you are ready, tap Add a book, choose a PDF, EPUB, Word document, or text file from your phone, and enjoy your own library.\n\nHappy listening!`;

async function initialize() {
  el.speed.value = String(speed);
  if (!el.speed.value || el.speed.selectedIndex < 0) { el.speed.value = '1'; speed = 1; }
  el.add.addEventListener('click', () => el.file.click());
  el.addMore.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => { const chosen = [...el.file.files]; el.file.value = ''; await handleFiles(chosen); });
  el.sample.addEventListener('click', async () => {
    try {
      const existing = library.find(book => book.format === 'DEMO');
      if (existing) return loadBook(existing.id, true);
      const book = { id: newId(), title: 'A little more time to read', format: 'DEMO', text: sampleText, lang: 'en-US', position: 0, addedAt: Date.now(), lastOpened: Date.now() };
      await saveBook(book); await refreshLibrary(); await loadBook(book.id, true); notify('Sample added. Tap Play to listen.');
    } catch (err) { notify(err.message, true); }
  });
  el.play.addEventListener('click', togglePlayback);
  el.back.addEventListener('click', () => skipSeconds(-15));
  el.forward.addEventListener('click', () => skipSeconds(15));
  el.slider.addEventListener('change', () => seekToFraction(Number(el.slider.value) / 1000));
  el.voice.addEventListener('change', () => {
    selectedVoice = el.voice.value;
    localStorage.setItem('bookvoice-voice', selectedVoice);
    if (speaking) speakFromPosition();
  });
  el.speed.addEventListener('change', () => {
    speed = Number(el.speed.value) || 1;
    localStorage.setItem('bookvoice-speed', String(speed));
    if (speaking) speakFromPosition(); else renderPlayer();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistProgress(); });
  window.addEventListener('pagehide', () => { if (active) saveBook(active).catch(() => {}); });
  if ('speechSynthesis' in window) {
    populateVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', populateVoices);
  }
  try {
    db = await openDatabase();
    await refreshLibrary();
    const last = localStorage.getItem('bookvoice-last');
    if (last && library.some(book => book.id === last)) await loadBook(last);
  } catch (err) { notify(`Cannot initialize local storage: ${err.message}`, true); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./service-worker.js').catch(err => console.info('Offline app registration unavailable:', err));
  }
}
initialize();