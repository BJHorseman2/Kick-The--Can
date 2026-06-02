/* WorkNotes — offline-first work note-taking PWA */
(() => {
  'use strict';

  const STORAGE_KEY = 'worknotes.v1';
  const $ = (sel) => document.querySelector(sel);

  // ---- State ----
  let notes = load();
  let activeTag = null;
  let query = '';
  let editingId = null;

  // ---- Elements ----
  const noteList = $('#noteList');
  const emptyState = $('#emptyState');
  const searchInput = $('#searchInput');
  const tagFilter = $('#tagFilter');
  const editor = $('#editor');
  const titleInput = $('#titleInput');
  const tagsInput = $('#tagsInput');
  const contentInput = $('#contentInput');
  const pinBtn = $('#pinBtn');
  const metaLine = $('#metaLine');

  // ---- Persistence ----
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Helpers ----
  function parseTags(str) {
    return [...new Set(
      str.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    )];
  }

  function relativeTime(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function preview(text) {
    return text.replace(/\[[ x]\]/gi, '').replace(/\s+/g, ' ').trim();
  }

  function allTags() {
    const set = new Set();
    notes.forEach((n) => n.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }

  function visibleNotes() {
    const q = query.toLowerCase();
    return notes
      .filter((n) => !activeTag || n.tags.includes(activeTag))
      .filter((n) => {
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.includes(q))
        );
      })
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  }

  // ---- Rendering ----
  function renderTags() {
    const tags = allTags();
    tagFilter.innerHTML = '';
    if (!tags.length) return;
    const mkChip = (label, value) => {
      const el = document.createElement('button');
      el.className = 'tag-chip' + (activeTag === value ? ' active' : '');
      el.textContent = label;
      el.addEventListener('click', () => {
        activeTag = activeTag === value ? null : value;
        render();
      });
      return el;
    };
    tagFilter.appendChild(mkChip('All', null));
    tags.forEach((t) => tagFilter.appendChild(mkChip('#' + t, t)));
  }

  function render() {
    renderTags();
    const list = visibleNotes();
    noteList.innerHTML = '';
    emptyState.hidden = notes.length !== 0;

    list.forEach((n) => {
      const card = document.createElement('article');
      card.className = 'note-card';
      card.addEventListener('click', () => openEditor(n.id));

      const top = document.createElement('div');
      top.className = 'nc-top';
      if (n.pinned) {
        const dot = document.createElement('span');
        dot.className = 'pin-dot';
        dot.textContent = '★';
        top.appendChild(dot);
      }
      const h = document.createElement('h3');
      h.textContent = n.title || 'Untitled';
      top.appendChild(h);
      card.appendChild(top);

      const body = preview(n.content);
      if (body) {
        const p = document.createElement('p');
        p.textContent = body;
        card.appendChild(p);
      }

      const meta = document.createElement('div');
      meta.className = 'nc-meta';
      const time = document.createElement('time');
      time.textContent = relativeTime(n.updated);
      meta.appendChild(time);
      n.tags.slice(0, 3).forEach((t) => {
        const tag = document.createElement('span');
        tag.className = 'nc-tag';
        tag.textContent = '#' + t;
        meta.appendChild(tag);
      });
      card.appendChild(meta);

      noteList.appendChild(card);
    });
  }

  // ---- Editor ----
  function openEditor(id) {
    const note = id ? notes.find((n) => n.id === id) : null;
    editingId = note ? note.id : null;
    titleInput.value = note ? note.title : '';
    tagsInput.value = note ? note.tags.join(', ') : '';
    contentInput.value = note ? note.content : '';
    updatePinBtn(note ? note.pinned : false);
    metaLine.textContent = note
      ? `Created ${new Date(note.created).toLocaleString()} · Updated ${relativeTime(note.updated)}`
      : 'New note';
    editor.hidden = false;
    editor.setAttribute('aria-hidden', 'false');
    if (!note) setTimeout(() => titleInput.focus(), 80);
  }

  function updatePinBtn(pinned) {
    pinBtn.textContent = pinned ? '★' : '☆';
    pinBtn.classList.toggle('primary', pinned);
    pinBtn.dataset.pinned = pinned ? '1' : '';
  }

  function commitEditor() {
    const title = titleInput.value.trim();
    const content = contentInput.value;
    const tags = parseTags(tagsInput.value);
    const pinned = pinBtn.dataset.pinned === '1';

    const isEmpty = !title && !content.trim() && !tags.length;

    if (editingId) {
      const note = notes.find((n) => n.id === editingId);
      if (isEmpty) {
        notes = notes.filter((n) => n.id !== editingId);
      } else if (note) {
        Object.assign(note, { title, content, tags, pinned, updated: Date.now() });
      }
    } else if (!isEmpty) {
      const now = Date.now();
      notes.push({ id: uid(), title, content, tags, pinned, created: now, updated: now });
    }
    save();
    closeEditor();
    render();
  }

  function closeEditor() {
    editor.hidden = true;
    editor.setAttribute('aria-hidden', 'true');
    editingId = null;
  }

  function deleteCurrent() {
    if (editingId && confirm('Delete this note?')) {
      notes = notes.filter((n) => n.id !== editingId);
      save();
      closeEditor();
      render();
    } else if (!editingId) {
      closeEditor();
    }
  }

  // ---- Events ----
  $('#newNoteBtn').addEventListener('click', () => openEditor(null));
  $('#backBtn').addEventListener('click', commitEditor);
  $('#saveBtn').addEventListener('click', commitEditor);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  pinBtn.addEventListener('click', () => updatePinBtn(pinBtn.dataset.pinned !== '1'));

  searchInput.addEventListener('input', (e) => {
    query = e.target.value;
    render();
  });

  // ---- Init ----
  render();

  // ---- Service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
