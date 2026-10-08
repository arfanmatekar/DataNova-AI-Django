(() => {
  'use strict';

  const readJson = (id, fallback) => {
    const node = document.getElementById(id);
    if (!node) return fallback;
    try {
      return JSON.parse(node.textContent || 'null') ?? fallback;
    } catch (error) {
      console.error(`Could not read ${id}.`, error);
      return fallback;
    }
  };

  const projects = readJson('project-data', []);
  let learning = readJson('learning-data', { milestones: [], score: 0, completed: 0, total: 0 });
  let dataset = readJson('dataset-data', null);
  let summary = readJson('summary-data', null);
  let currentPage = 1;
  let activeFilter = 'all';
  let searchQuery = '';
  let editingProjectId = null;
  let lastInsight = null;
  let toastTimer = null;
  const PAGE_SIZE = 8;
  const COLORS = ['#7865d6', '#65a1dd', '#56ae8c', '#e3a45d', '#dc83a7', '#55aaad'];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const workspace = $('#workspace');
  const projectId = Number(workspace?.dataset.projectId || 0);
  const apiBase = projectId ? `/api/projects/${projectId}/` : '/api/projects/';
  const csrfToken = $('input[name="csrfmiddlewaretoken"]', $('#csrf-token') || document)?.value || '';

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: JSON.stringify(body),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('The server returned an unreadable response. Please try again.');
    }
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }

  function showToast(message, isError = false) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('toast-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('toast-visible'), 3400);
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function updateLearning(nextLearning) {
    if (!nextLearning) return;
    learning = nextLearning;
    const score = $('#learning-score');
    const statScore = $('#stat-score');
    const progress = $('#learning-progress');
    const caption = $('#learning-caption');
    const detailCaption = $('#detail-learning-caption');
    const detailScore = $('#detail-learning-score');
    if (score) score.textContent = `${learning.score}%`;
    if (statScore) {
      statScore.replaceChildren(
        document.createTextNode(String(learning.score)),
        Object.assign(document.createElement('span'), { className: 'stat-percent', textContent: '%' }),
      );
    }
    if (progress) progress.style.width = `${learning.score}%`;
    if (caption) caption.textContent = `${learning.completed} of ${learning.total} milestones complete`;
    if (detailCaption) detailCaption.textContent = `${learning.completed} of ${learning.total} learning milestones complete.`;
    if (detailScore) detailScore.textContent = `${learning.score}%`;

    const list = $('#milestone-list');
    if (!list) return;
    list.replaceChildren(...learning.milestones.map((milestone) => {
      const item = document.createElement('li');
      item.className = `milestone-item${milestone.completed ? ' milestone-done' : ''}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'milestone-check';
      button.dataset.milestoneId = milestone.id;
      button.setAttribute('aria-pressed', String(milestone.completed));
      button.setAttribute('aria-label', `${milestone.completed ? 'Mark incomplete' : 'Complete'}: ${milestone.title}`);
      button.textContent = milestone.completed ? '✓' : '';
      const copy = document.createElement('span');
      copy.className = 'milestone-copy';
      const title = document.createElement('strong');
      title.textContent = milestone.title;
      const description = document.createElement('small');
      description.textContent = milestone.description;
      copy.append(title, description);
      item.append(button, copy);
      return item;
    }));
  }

  function renderProjects() {
    const grid = $('#project-grid');
    if (!grid) return;
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const filtered = projects.filter((project) => {
      const matchesSearch = `${project.name} ${project.description}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesSearch && (activeFilter === 'all' || project.status === activeFilter);
    });
    const total = projects.length;
    const active = projects.filter((project) => project.status === 'active').length;
    const completed = projects.filter((project) => project.status === 'completed').length;
    $('#stat-total').textContent = String(total);
    $('#stat-active').textContent = String(active);
    $('#stat-completed').textContent = String(completed);
    $('#nav-project-count').textContent = String(total);
    $('#visible-project-count').textContent = String(filtered.length);

    const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
    currentPage = Math.min(currentPage, Math.max(pageCount, 1));
    const visibleProjects = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    grid.replaceChildren(...visibleProjects.map((project, index) => {
      const card = document.createElement('article');
      card.className = 'project-card';
      const top = document.createElement('div');
      top.className = 'project-card-top';
      const avatar = document.createElement('span');
      avatar.className = `project-avatar project-avatar-${index % 6}`;
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = project.name.trim().charAt(0).toLocaleUpperCase() || '✳';
      const status = document.createElement('span');
      status.className = 'status-badge';
      status.dataset.status = project.status;
      status.textContent = project.status_label;
      top.append(avatar, status);
      const heading = document.createElement('h3');
      heading.textContent = project.name;
      const description = document.createElement('p');
      description.className = 'project-description';
      description.textContent = project.description || 'A fresh space for your next big discovery.';
      const footer = document.createElement('div');
      footer.className = 'project-card-footer';
      const updated = document.createElement('span');
      updated.className = 'project-updated';
      const date = new Date(project.updated_at);
      updated.textContent = `${project.row_count ? `${project.row_count.toLocaleString()} rows · ` : ''}${Number.isNaN(date.getTime()) ? '' : `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}`;
      const actions = document.createElement('div');
      actions.className = 'project-action-buttons';
      const analytics = document.createElement('a');
      analytics.className = 'project-action';
      analytics.href = project.url;
      analytics.textContent = 'View analytics →';
      const edit = document.createElement('button');
      edit.className = 'project-action';
      edit.type = 'button';
      edit.dataset.editProject = project.id;
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${project.name}`);
      const remove = document.createElement('button');
      remove.className = 'project-action project-action-delete';
      remove.type = 'button';
      remove.dataset.deleteProject = project.id;
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${project.name}`);
      actions.append(analytics, edit, remove);
      footer.append(updated, actions);
      card.append(top, heading, description, footer);
      return card;
    }));

    $('#empty-state').hidden = total === 0 || filtered.length > 0;
    $('#first-project-state').hidden = total !== 0;
  }

  function openProjectModal(project = null) {
    const modal = $('#project-modal');
    if (!modal) return;
    editingProjectId = project?.id || null;
    $('#modal-title').textContent = project ? 'Edit your project' : 'Create a project';
    const submit = $('#project-submit');
    const submitArrow = document.createElement('span');
    submitArrow.textContent = '→';
    submitArrow.setAttribute('aria-hidden', 'true');
    submit.replaceChildren(
      document.createTextNode(project ? 'Save changes ' : 'Create project '),
      submitArrow,
    );
    $('#project-name').value = project?.name || '';
    $('#project-description').value = project?.description || '';
    $('#project-status').value = project?.status || 'planning';
    $('#project-form-error').textContent = '';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => $('#project-name').focus(), 20);
  }

  function closeProjectModal() {
    const modal = $('#project-modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
  }

  function syncSearch(value) {
    searchQuery = value;
    $$('#project-search, #project-search-secondary').forEach((input) => {
      if (input.value !== value) input.value = value;
    });
    currentPage = 1;
    renderProjects();
  }

  const createButtons = ['#new-project-button', '#empty-new-project'].map((selector) => $(selector)).filter(Boolean);
  createButtons.forEach((button) => button.addEventListener('click', () => openProjectModal()));
  $('#modal-close')?.addEventListener('click', closeProjectModal);
  $('#modal-cancel')?.addEventListener('click', closeProjectModal);
  $('#project-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeProjectModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProjectModal();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      const search = $('#project-search') || $('#project-search-secondary');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
  });

  $('#project-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#project-submit');
    setButtonLoading(submit, true, editingProjectId ? 'Saving…' : 'Creating…');
    $('#project-form-error').textContent = '';
    const data = {
      name: $('#project-name').value.trim(),
      description: $('#project-description').value.trim(),
      status: $('#project-status').value,
    };
    try {
      const response = await postJson(
        editingProjectId ? `/api/projects/${editingProjectId}/` : '/api/projects/',
        data,
      );
      if (editingProjectId) {
        const index = projects.findIndex((project) => project.id === response.project.id);
        if (index !== -1) projects[index] = response.project;
        if (projectId === response.project.id) {
          window.location.assign(response.project.url);
          return;
        }
      } else {
        projects.unshift(response.project);
      }
      if (response.learning) updateLearning(response.learning);
      closeProjectModal();
      renderProjects();
      showToast(editingProjectId ? 'Your project has been updated.' : 'Your new project is ready.');
    } catch (error) {
      $('#project-form-error').textContent = error.message;
    } finally {
      setButtonLoading(submit, false);
    }
  });

  $('#project-grid')?.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit-project]');
    const deleteButton = event.target.closest('[data-delete-project]');
    if (editButton) {
      const project = projects.find((item) => item.id === Number(editButton.dataset.editProject));
      if (project) openProjectModal(project);
    }
    if (deleteButton) {
      const project = projects.find((item) => item.id === Number(deleteButton.dataset.deleteProject));
      if (!project || !window.confirm(`Delete "${project.name}" and its uploaded dataset? This cannot be undone.`)) return;
      deleteButton.disabled = true;
      try {
        await postJson(`/api/projects/${project.id}/`, { action: 'delete' });
        const index = projects.findIndex((item) => item.id === project.id);
        if (index !== -1) projects.splice(index, 1);
        renderProjects();
        showToast('Your project has been deleted.');
      } catch (error) {
        deleteButton.disabled = false;
        showToast(error.message, true);
      }
    }
  });

  $('#status-filter')?.addEventListener('change', (event) => {
    activeFilter = event.target.value;
    currentPage = 1;
    renderProjects();
  });
  $$('#project-search, #project-search-secondary').forEach((input) => {
    input.addEventListener('input', (event) => syncSearch(event.target.value));
  });
  $('#clear-filters')?.addEventListener('click', () => {
    activeFilter = 'all';
    const status = $('#status-filter');
    if (status) status.value = 'all';
    syncSearch('');
  });
  renderProjects();
  updateLearning(learning);

  $$('#milestone-list').forEach((list) => list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-milestone-id]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await postJson(`/api/milestones/${button.dataset.milestoneId}/`, {
        completed: button.getAttribute('aria-pressed') !== 'true',
      });
      updateLearning(result.learning);
      showToast('Learning score updated. Keep up the great work!');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, true);
    }
  }));

  $('#notification-button')?.addEventListener('click', () => {
    const popover = $('#notification-popover');
    popover.hidden = !popover.hidden;
  });
  $$('.workspace-switcher, .workspace-pill').forEach((button) => {
    button.addEventListener('click', () => showToast('Professional workspace is your active workspace.'));
  });
  $('#mobile-menu')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('sidebar-open'));
  $('#sidebar')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) $('#sidebar').classList.remove('sidebar-open');
  });

  function setChatEnabled(enabled) {
    const input = $('#chat-input');
    const submit = $('.chat-submit');
    if (input) input.disabled = !enabled;
    if (submit) submit.disabled = !enabled;
  }

  function appendChatMessage(kind, text) {
    const messages = $('#chat-messages');
    if (!messages) return null;
    const node = document.createElement('div');
    if (kind === 'question') {
      node.className = 'chat-question';
      node.textContent = text;
    } else if (kind === 'thinking') {
      node.className = 'chat-thinking';
      node.textContent = text;
    } else {
      node.className = 'chat-answer';
      const avatar = document.createElement('span');
      avatar.className = 'chat-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = '✳';
      const answer = document.createElement('p');
      answer.textContent = text;
      node.append(avatar, answer);
    }
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }

  async function askQuestion(question) {
    if (!question || !dataset || !projectId) return;
    const input = $('#chat-input');
    const submit = $('.chat-submit');
    appendChatMessage('question', question);
    const thinking = appendChatMessage('thinking', 'Taking a closer look at your data…');
    if (input) input.value = '';
    setChatEnabled(false);
    try {
      const result = await postJson(`${apiBase}ask/`, { question });
      thinking?.remove();
      appendChatMessage('answer', result.answer);
      lastInsight = { question, answer: result.answer };
      summary = result.summary;
      updateLearning(result.learning);
    } catch (error) {
      thinking?.remove();
      appendChatMessage('answer', error.message);
      showToast(error.message, true);
    } finally {
      setChatEnabled(true);
      input?.focus();
      if (submit) submit.disabled = !dataset;
    }
  }

  $('#chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = $('#chat-input').value.trim();
    if (question) askQuestion(question);
  });
  $$('.prompt-chip').forEach((button) => button.addEventListener('click', () => askQuestion(button.dataset.prompt)));

  function setUploadMessage(text, isError = false) {
    const status = $('#upload-status');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('status-error', isError);
  }

  function escapeText(value) {
    return escapeHtml(value);
  }

  function renderDatasetPage() {
    if (!dataset) {
      const caption = $('#dataset-caption');
      if (caption) caption.textContent = 'Upload a file to start exploring.';
      const table = $('#dataset-table-wrap');
      if (table) table.hidden = true;
      const footer = $('#table-footer');
      if (footer) footer.hidden = true;
      const dropzone = $('#upload-dropzone');
      if (dropzone) dropzone.hidden = false;
      setChatEnabled(false);
      renderCharts();
      return;
    }
    currentPage = Math.min(currentPage, Math.max(1, Math.ceil(dataset.rows.length / PAGE_SIZE)));
    const start = (currentPage - 1) * PAGE_SIZE;
    const displayedRows = dataset.rows.slice(start, start + PAGE_SIZE);
    const count = dataset.rows.length;
    const caption = $('#dataset-caption');
    if (caption) caption.textContent = `${dataset.filename} · ${count.toLocaleString()} rows · ${dataset.columns.length} columns`;
    $('#upload-dropzone').hidden = true;
    $('#dataset-table-wrap').hidden = false;
    $('#table-footer').hidden = count <= PAGE_SIZE;

    const head = $('#dataset-head');
    head.replaceChildren();
    const headingRow = document.createElement('tr');
    const rowNumberHeading = document.createElement('th');
    rowNumberHeading.scope = 'col';
    rowNumberHeading.textContent = '#';
    headingRow.append(rowNumberHeading);
    dataset.columns.forEach((column) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = column;
      headingRow.append(cell);
    });
    const thead = document.createElement('thead');
    thead.append(headingRow);
    head.replaceWith(thead);
    thead.id = 'dataset-head';

    const body = $('#dataset-body');
    body.replaceChildren(...displayedRows.map((row, index) => {
      const tr = document.createElement('tr');
      const rowNumber = document.createElement('td');
      rowNumber.textContent = String(start + index + 1);
      tr.append(rowNumber);
      dataset.columns.forEach((column) => {
        const cell = document.createElement('td');
        const value = row[column];
        cell.textContent = value === null || value === undefined ? '—' : String(value);
        cell.title = cell.textContent;
        tr.append(cell);
      });
      return tr;
    }));

    if (count > PAGE_SIZE) {
      $('#table-page-caption').textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, count)} of ${count.toLocaleString()} rows`;
      $('#page-indicator').textContent = `${currentPage} / ${Math.ceil(count / PAGE_SIZE)}`;
      $('#page-previous').disabled = currentPage === 1;
      $('#page-next').disabled = currentPage >= Math.ceil(count / PAGE_SIZE);
    }
    setChatEnabled(true);
    renderCharts();
  }

  $('#page-previous')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderDatasetPage();
    }
  });
  $('#page-next')?.addEventListener('click', () => {
    if (dataset && currentPage < Math.ceil(dataset.rows.length / PAGE_SIZE)) {
      currentPage += 1;
      renderDatasetPage();
    }
  });

  async function uploadFile(file) {
    if (!file) return;
    const filename = file.name.toLocaleLowerCase();
    if (!/\.(csv|xlsx|json)$/.test(filename)) {
      setUploadMessage('Choose a .csv, .xlsx, or .json file.', true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadMessage('Your file is bigger than 5 MB. Choose a smaller file.', true);
      return;
    }
    const button = $('#upload-trigger');
    setButtonLoading(button, true, 'Reading your data…');
    setUploadMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${apiBase}dataset/`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': csrfToken },
        body: formData,
      });
      const result = await response.json().catch(() => {
        throw new Error('The server returned an unreadable response. Please try again.');
      });
      if (!response.ok) throw new Error(result.error || 'This file could not be uploaded.');
      dataset = result.dataset;
      summary = result.summary;
      currentPage = 1;
      lastInsight = null;
      const messages = $('#chat-messages');
      messages.replaceChildren();
      appendChatMessage('answer', `Your dataset is ready to explore: ${dataset.rows.length.toLocaleString()} rows across ${dataset.columns.length} columns. Try asking me for trends, a total, or potential anomalies.`);
      renderDatasetPage();
      updateLearning(result.learning);
      setUploadMessage(`${dataset.filename} is ready — ${dataset.rows.length.toLocaleString()} rows loaded.`);
      showToast('Your dataset is ready to explore.');
    } catch (error) {
      setUploadMessage(error.message, true);
      showToast(error.message, true);
    } finally {
      setButtonLoading(button, false);
    }
  }

  $('#upload-trigger')?.addEventListener('click', () => $('#dataset-file')?.click());
  $('#browse-files')?.addEventListener('click', () => $('#dataset-file')?.click());
  $('#dataset-file')?.addEventListener('change', (event) => {
    uploadFile(event.target.files?.[0]);
    event.target.value = '';
  });
  const dropzone = $('#upload-dropzone');
  dropzone?.addEventListener('click', () => $('#dataset-file')?.click());
  dropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('#dataset-file')?.click();
    }
  });
  dropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone?.addEventListener('dragleave', (event) => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over');
  });
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    uploadFile(event.dataTransfer?.files?.[0]);
  });

  function numericValue(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function numericColumns() {
    if (!dataset) return [];
    return dataset.columns.map((column) => {
      const entries = dataset.rows.map((row, index) => ({ label: row[column], index, value: numericValue(row[column]) }))
        .filter((entry) => entry.value !== null);
      return { column, entries };
    }).filter((item) => item.entries.length > 0);
  }

  function categoryColumn(columns = dataset?.columns || [], numbers = numericColumns()) {
    const categorical = columns.filter(
      (column) => !numbers.some((item) => item.column === column),
    );
    return categorical.find((column) => (
      /category|segment|region|product|group|status|class|type|channel|department/i.test(column)
    )) || categorical[0];
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.scale(dpr, dpr);
    return { context, width, height };
  }

  function chartPlaceholder(kind, visible) {
    const empty = $(`#${kind}-chart-empty`);
    const canvas = $(`#${kind}-chart`);
    if (empty) empty.hidden = visible;
    if (canvas) canvas.hidden = !visible;
    if (!visible) {
      const legend = $(`#${kind}-chart-legend`);
      if (legend) legend.replaceChildren();
    }
    return canvas;
  }

  function setLegend(element, entries) {
    if (!element) return;
    element.replaceChildren(...entries.map((entry, index) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.backgroundColor = COLORS[index % COLORS.length];
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = entry;
      item.append(dot, label);
      return item;
    }));
  }

  function drawBarChart(canvas, column) {
    const ready = chartPlaceholder('bar', Boolean(canvas && column));
    if (!ready || !column) return;
    $('#bar-chart-title').textContent = `${column.column} by record`;
    const { context: ctx, width, height } = prepareCanvas(ready);
    if (!ctx) return;
    const entries = column.entries.slice(0, 7);
    const max = Math.max(...entries.map((entry) => Math.abs(entry.value)), 1);
    const left = 31;
    const right = 5;
    const top = 8;
    const bottom = 28;
    const plotHeight = height - top - bottom;
    const chartWidth = width - left - right;
    ctx.strokeStyle = '#f0eff5';
    ctx.lineWidth = 1;
    ctx.font = '8px "DM Sans", sans-serif';
    ctx.fillStyle = '#9b99a8';
    for (let tick = 0; tick <= 3; tick += 1) {
      const y = top + plotHeight - plotHeight * tick / 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
      ctx.fillText(formatCompact(max * tick / 3), 0, y + 3);
    }
    const slot = chartWidth / entries.length;
    entries.forEach((entry, index) => {
      const barWidth = Math.min(22, slot * .48);
      const barHeight = Math.max(2, plotHeight * Math.abs(entry.value) / max);
      const x = left + slot * index + (slot - barWidth) / 2;
      const y = top + plotHeight - barHeight;
      ctx.fillStyle = COLORS[index % COLORS.length];
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
      ctx.fill();
      ctx.fillStyle = '#918fa0';
      ctx.textAlign = 'center';
      const label = categoryColumn(dataset.columns);
      const labelText = label ? dataset.rows[entry.index]?.[label] : entry.index + 1;
      ctx.fillText(String(labelText ?? '').slice(0, 8), x + barWidth / 2, height - 11);
      ctx.textAlign = 'left';
    });
    setLegend($('#bar-chart-legend'), [column.column]);
  }

  function drawLineChart(canvas, column) {
    const ready = chartPlaceholder('line', Boolean(canvas && column && column.entries.length > 1));
    if (!ready || !column || column.entries.length < 2) return;
    $('#line-chart-title').textContent = `${column.column} over rows`;
    const { context: ctx, width, height } = prepareCanvas(ready);
    if (!ctx) return;
    const left = 31;
    const right = 7;
    const top = 10;
    const bottom = 22;
    const plotHeight = height - top - bottom;
    const chartWidth = width - left - right;
    const values = column.entries.map((entry) => entry.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    ctx.strokeStyle = '#f0eff5';
    ctx.fillStyle = '#9b99a8';
    ctx.font = '8px "DM Sans", sans-serif';
    for (let tick = 0; tick <= 3; tick += 1) {
      const y = top + plotHeight - plotHeight * tick / 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
    }
    const points = column.entries.slice(0, 35).map((entry, index, list) => ({
      x: left + (list.length === 1 ? chartWidth / 2 : chartWidth * index / (list.length - 1)),
      y: top + plotHeight - (entry.value - min) / span * (plotHeight * .82) - plotHeight * .09,
    }));
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, top + plotHeight);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points.at(-1).x, top + plotHeight);
    ctx.closePath();
    ctx.fillStyle = '#7865d615';
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#7865d6';
    ctx.stroke();
    const last = points.at(-1);
    ctx.fillStyle = '#7865d6';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fill();
    setLegend($('#line-chart-legend'), [column.column]);
  }

  function drawPieChart(canvas, numbers) {
    let entries = [];
    let label = '';
    if (dataset) {
      const categorical = categoryColumn(dataset.columns, numbers);
      if (categorical) {
        const valueColumn = numbers.find((item) => /sales|revenue|amount|price|total|profit/i.test(item.column)) || numbers[0];
        const groups = new Map();
        dataset.rows.forEach((row) => {
          const name = String(row[categorical] ?? 'Unspecified');
          const amount = valueColumn ? numericValue(row[valueColumn.column]) : 1;
          if (amount !== null) groups.set(name, (groups.get(name) || 0) + Math.abs(amount));
        });
        entries = [...groups].map(([name, value]) => ({ name, value })).filter((entry) => entry.value > 0);
        entries.sort((a, b) => b.value - a.value);
        label = categorical;
      } else {
        entries = numbers.map((item) => ({
          name: item.column,
          value: item.entries.reduce((total, entry) => total + Math.abs(entry.value), 0),
        })).filter((entry) => entry.value > 0);
        label = 'Numeric columns';
      }
    }
    entries = entries.slice(0, 5);
    const ready = chartPlaceholder('pie', Boolean(canvas && entries.length));
    const center = $('#donut-center');
    if (!ready || !entries.length) {
      if (center) center.hidden = true;
      return;
    }
    $('#pie-chart-title').textContent = label === 'Numeric columns' ? 'Numeric breakdown' : `Breakdown by ${label}`;
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    const { context: ctx, width, height } = prepareCanvas(ready);
    if (!ctx) return;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * .36;
    const thickness = Math.max(11, Math.min(17, radius * .27));
    let start = -Math.PI / 2;
    entries.forEach((entry, index) => {
      const end = start + (entry.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, start, end);
      ctx.strokeStyle = COLORS[index % COLORS.length];
      ctx.lineWidth = thickness;
      ctx.lineCap = 'butt';
      ctx.stroke();
      start = end;
    });
    center.hidden = false;
    $('#donut-total').textContent = total >= 100000 ? `${(total / 1000).toFixed(0)}k` : formatCompact(total);
    setLegend($('#pie-chart-legend'), entries.slice(0, 4).map((entry) => `${entry.name} · ${Math.round(entry.value / total * 100)}%`));
  }

  function formatCompact(value) {
    return Intl.NumberFormat(undefined, { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  }

  function renderCharts() {
    const numbers = numericColumns();
    const firstColumn = numbers[0];
    drawBarChart($('#bar-chart'), firstColumn);
    drawLineChart($('#line-chart'), firstColumn);
    drawPieChart($('#pie-chart'), numbers);
    const caption = $('#charts-caption');
    if (caption) {
      caption.textContent = dataset
        ? `${dataset.rows.length.toLocaleString()} records · ${numbers.length} numeric ${numbers.length === 1 ? 'field' : 'fields'} visualized live.`
        : 'Charts update automatically when you upload a dataset.';
    }
  }

  if (dataset) {
    $('#chat-messages')?.replaceChildren();
    appendChatMessage('answer', `Welcome back! Your ${dataset.filename} dataset has ${dataset.rows.length.toLocaleString()} rows and ${dataset.columns.length} columns. What would you like to find out?`);
    renderDatasetPage();
  }
  window.addEventListener('resize', () => {
    if (dataset) renderCharts();
  });

  function printableTable(columns, rows) {
    if (!columns?.length || !rows?.length) return '<p>No dataset has been uploaded yet.</p>';
    const headings = columns.map((column) => `<th>${escapeText(column)}</th>`).join('');
    const body = rows.slice(0, 15).map((row) =>
      `<tr>${columns.map((column) => `<td>${escapeText(row[column])}</td>`).join('')}</tr>`,
    ).join('');
    return `<table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table><p class="note">Showing up to 15 rows from ${rows.length.toLocaleString()} total records.</p>`;
  }

  $('#download-report')?.addEventListener('click', () => {
    if (!summary || !dataset) {
      showToast('Upload a dataset to include data insights in your report.', true);
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    const completedMilestones = learning.milestones.filter((item) => item.completed);
    const statistics = Object.entries(summary.numeric || {}).map(([column, stat]) => (
      `<tr><th>${escapeText(column)}</th><td>${stat.count.toLocaleString()}</td><td>${escapeText(stat.sum)}</td><td>${escapeText(stat.average)}</td><td>${escapeText(stat.minimum)} – ${escapeText(stat.maximum)}</td></tr>`
    )).join('');
    const insight = lastInsight
      ? `<section><h2>AI data insight</h2><p><strong>Question:</strong> ${escapeText(lastInsight.question)}</p><p>${escapeText(lastInsight.answer)}</p></section>`
      : '<section><h2>AI data insight</h2><p>Open your project and ask a question about the dataset to include a custom insight here.</p></section>';
    const report = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(project?.name || document.title)} — DataNova report</title>
<style>*{box-sizing:border-box}body{max-width:820px;margin:42px auto;padding:0 25px;color:#242338;background:#fff;font:14px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}header{padding-bottom:20px;border-bottom:2px solid #7763d4}header p,.muted{color:#77768a}.brand{color:#7060db;font-size:12px;font-weight:700;letter-spacing:2px}h1{margin:13px 0 4px;font-size:30px;letter-spacing:-1px}h2{margin:27px 0 12px;font-size:18px}h3{margin:0;color:#56546a;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.metric{padding:14px;border:1px solid #eceaf3;border-radius:9px}.metric strong{display:block;margin-top:5px;font-size:19px}.metric span{color:#747287;font-size:10px}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:9px;border-bottom:1px solid #eeedf3;font-size:11px}thead th{background:#f6f5fa}.milestones{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.milestones li{padding:6px 10px;border:1px solid #e9e6f1;border-radius:99px;font-size:10px}.note,footer{color:#838193;font-size:10px}section{margin-top:18px}@media print{body{margin:0 auto;padding:8px}.no-print{display:none!important}}</style></head>
<body><header><span class="brand">✳ DATANOVA AI · PROJECT REPORT</span><h1>${escapeText(project?.name || '')}</h1><p>${escapeText(project?.description || 'A DataNova AI analytics project')} · ${new Date().toLocaleString()}</p></header>
<div class="metrics"><div class="metric"><span>Dataset records</span><strong>${summary.row_count.toLocaleString()}</strong></div><div class="metric"><span>Dataset fields</span><strong>${summary.column_count.toLocaleString()}</strong></div><div class="metric"><span>Learning score</span><strong>${learning.score}%</strong></div></div>
<section><h2>Project overview</h2><p><strong>Status:</strong> ${escapeText(project?.status_label || '')}</p><p><strong>Uploaded file:</strong> ${escapeText(dataset.filename)}</p></section>
${insight}
<section><h2>Dataset statistics</h2><table><thead><tr><th>Numeric field</th><th>Values</th><th>Total</th><th>Average</th><th>Range</th></tr></thead><tbody>${statistics || '<tr><td colspan="5">No numeric fields found.</td></tr>'}</tbody></table></section>
<section><h2>Learning milestones</h2><p>${learning.completed} of ${learning.total} milestones complete.</p><ul class="milestones">${completedMilestones.map((item) => `<li>✓ ${escapeText(item.title)}</li>`).join('') || '<li>No milestones completed yet.</li>'}</ul></section>
<section><h2>Dataset preview</h2>${printableTable(dataset.columns, dataset.rows)}</section>
<footer>Generated with DataNova AI · Your data stays in your local workspace.</footer>
<p class="no-print"><button onclick="window.print()">Print or save as PDF</button></p></body></html>`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([report], { type: 'text/html;charset=utf-8' }));
    link.download = `${(project?.name || 'datanova-report').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').slice(0, 80)}-report.html`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    showToast('Your project report is ready. Open it to print or save as PDF.');
  });
})();
