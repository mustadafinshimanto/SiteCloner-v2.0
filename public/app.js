/**
 * SiteCloner — Frontend Application Logic
 * Handles URL submission, SSE progress streaming, preview, and history.
 */

(function () {
  'use strict';

  // ===== DOM Elements =====
  const cloneForm = document.getElementById('clone-form');
  const urlInput = document.getElementById('url-input');
  const cloneBtn = document.getElementById('clone-btn');
  const optionsToggle = document.getElementById('options-toggle');
  const optionsPanel = document.getElementById('options-panel');
  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const progressPercent = document.getElementById('progress-percent');
  const statusText = document.getElementById('status-text');
  const statusIndicator = document.getElementById('status-indicator');
  const progressLog = document.getElementById('progress-log');
  const statsGrid = document.getElementById('stats-grid');
  const actionsSection = document.getElementById('actions-section');
  const downloadBtn = document.getElementById('download-btn');
  const previewBtn = document.getElementById('preview-btn');
  const newCloneBtn = document.getElementById('new-clone-btn');
  const previewSection = document.getElementById('preview-section');
  const previewIframe = document.getElementById('preview-iframe');
  const previewUrl = document.getElementById('preview-url');
  const previewClose = document.getElementById('preview-close');
  const previewLaunchBtn = document.getElementById('preview-launch-btn');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const clearBtn = document.getElementById('clear-history-btn');

  // Stats elements
  const statCSS = document.getElementById('stat-css');
  const statJS = document.getElementById('stat-js');
  const statImages = document.getElementById('stat-images');
  const statFonts = document.getElementById('stat-fonts');
  const statAnimations = document.getElementById('stat-animations');
  const statPages = document.getElementById('stat-pages');
  const statAI = document.getElementById('stat-ai');
  const aiStatCard = document.getElementById('ai-stat-card');
  const statSize = document.getElementById('stat-size');

  // ===== State =====
  let currentJobId = null;
  let eventSource = null;
  let isCloneFinished = false;

  // ===== Initialization & Recovery (v2.13) =====
  function init() {
    const history = loadHistory();
    renderHistory();

    if (history.length > 0) {
      const lastJob = history[0];
      // If the last job was the one we just worked on or is currently running
      if (lastJob.status === 'running') {
        currentJobId = lastJob.id;
        progressSection.classList.remove('hidden');
        connectSSE(lastJob.id, lastJob.url);
      } else if (lastJob.status === 'completed') {
        // Auto-show the card for the most recent success if page was refreshed
        currentJobId = lastJob.id;
        progressSection.classList.remove('hidden');
        if (lastJob.result) {
          onCloneComplete(lastJob.result, lastJob.url);
        } else {
           // Fallback to minimal state if result is missing from history local
           statusText.textContent = 'Clone complete!';
           statusIndicator.classList.add('done');
           progressBar.style.width = '100%';
           progressPercent.textContent = '100%';
           actionsSection.classList.remove('hidden');
        }
      }
    }
  }

  // Run init
  init();

  // ===== Advanced Options Toggle =====

  // ===== Form Submission =====
  cloneForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const url = urlInput.value.trim();
    if (!url) return;

    // Validate URL
    try {
      new URL(url);
    } catch {
      showError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    // Gather options
    const options = {
      waitTimeout: parseInt(document.getElementById('opt-timeout').value) || 30000,
      scrollToBottom: document.getElementById('opt-scroll').checked,
      captureJS: document.getElementById('opt-js').checked,
      fullClone: document.getElementById('opt-full').checked,
      aiFinish: document.getElementById('opt-ai').checked,
      viewport: {
        width: parseInt(document.getElementById('opt-viewport').value) || 1920,
        height: 1080,
      },
    };

    await startClone(url, options);
  });

  // ===== Start Clone Job =====
  async function startClone(url, options) {
    // Reset UI
    resetProgress();
    isCloneFinished = false;
    setLoading(true);
    progressSection.classList.remove('hidden');
    actionsSection.classList.add('hidden');
    previewSection.classList.add('hidden');

    // Smooth scroll to progress
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
      const response = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, options }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start clone job');
      }

      const { jobId } = await response.json();
      currentJobId = jobId;

      // Add to history
      addToHistory({ id: jobId, url, status: 'running', createdAt: new Date().toISOString() });

      // Connect SSE
      connectSSE(jobId, url);

    } catch (err) {
      setLoading(false);
      showError(err.message);
    }
  }

  // ===== SSE Connection =====
  function connectSSE(jobId, url) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/status/${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.phase === 'complete') {
        onCloneComplete(data.result, url);
        eventSource.close();
        return;
      }

      if (data.phase === 'error') {
        onCloneError(data.error);
        eventSource.close();
        return;
      }

      updateProgress(data);
    };

    eventSource.onerror = () => {
      // SSE connection lost — check job status via polling if not finished
      if (isCloneFinished) return;
      eventSource.close();
      pollJobStatus(jobId, url);
    };
  }

  // ===== Poll Job Status =====
  async function pollJobStatus(jobId, url) {
    try {
      if (isCloneFinished) return;
      const response = await fetch(`/api/job/${jobId}`);
      const job = await response.json();

      if (isCloneFinished) return;
      if (job.status === 'completed') {
        onCloneComplete(job.result, url || urlInput.value);
      } else if (job.status === 'failed') {
        onCloneError(job.error);
      } else {
        // Still running — try reconnecting SSE
        setTimeout(() => connectSSE(jobId, url), 2000);
      }
    } catch {
      if (!isCloneFinished) {
        onCloneError('Lost connection to server');
      }
    }
  }

  // ===== Update Progress UI =====
  // ===== Update Progress UI =====
  function updateProgress(data) {
    // Update progress bar
    if (typeof data.percent === 'number') {
      progressBar.style.width = data.percent + '%';
      progressPercent.textContent = Math.round(data.percent) + '%';
    }

    // V11: Update Neural Stats & Glow
    if (data.phase === 'ai') {
      aiStatCard.classList.add('active-ai');
      if (typeof data.patches === 'number') {
        const currentCount = parseInt(statAI.textContent) || 0;
        statAI.textContent = currentCount + data.patches;
      }
    } else if (data.phase !== 'ai' && aiStatCard.classList.contains('active-ai')) {
      // Clear AI glow if we leave AI phase (e.g. to download or done)
      // but only if we weren't just in the middle of a continuous AI pass
      if (data.phase !== 'init' && data.phase !== 'download') {
         aiStatCard.classList.remove('active-ai');
      }
    }

    // Update status text
    if (data.message) {
      statusText.textContent = data.message;
    }

    // Add log entry
    if (data.message) {
      addLogEntry(data.phase, data.message);
    }

    // V11: Proactive Sync (v2.11)
    if (data.phase === 'done') {
      // If result is fused, use it immediately to unlock dashboard (v2.11)
      if (data.result) {
        onCloneComplete(data.result, urlInput.value);
      }
      setTimeout(() => renderHistory(), 500);
    }
  }

  // ===== Add Log Entry =====
  function addLogEntry(phase, message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
      <span class="log-phase">[${phase}]</span>
      <span class="log-message">${escapeHTML(message)}</span>
    `;
    progressLog.appendChild(entry);
    progressLog.scrollTop = progressLog.scrollHeight;

    // Keep only last 50 entries
    while (progressLog.children.length > 50) {
      progressLog.removeChild(progressLog.firstChild);
    }
  }

  // ===== Clone Complete (v2.15 Neural Visibility Shield) =====
  function onCloneComplete(result, url) {
    if (isCloneFinished) return;
    isCloneFinished = true;
    setLoading(false);

    // [PRIORITY 1] ABSOLUTE VISIBILITY Handshake (Reveal Buttons FIRST)
    actionsSection.classList.remove('hidden');
    actionsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Update progress to 100%
    progressBar.style.width = '100%';
    progressPercent.textContent = '100%';
    statusText.textContent = 'Clone complete!';
    statusIndicator.classList.add('done');

    // [PRIORITY 2] Fault-Tolerant Stats Logic
    try {
      if (result && result.stats) {
        const stats = result.stats;
        statCSS.textContent = stats.assets?.byCategory?.css?.count || 0;
        statJS.textContent = stats.assets?.byCategory?.js?.count || 0;
        statImages.textContent = stats.assets?.byCategory?.images?.count || 0;
        statFonts.textContent = stats.assets?.byCategory?.fonts?.count || 0;
        statAnimations.textContent = (stats.css?.keyframes || 0) + (stats.css?.animationRules || 0);
        statPages.textContent = stats.pages || 1;
        statSize.textContent = formatSize(stats.assets?.totalSize || result.zipSize || 0);
        
        if (stats.ai) {
          aiStatCard.classList.remove('active-ai');
          statAI.textContent = stats.ai?.appliedPatches || 0;
        }
        statsGrid.classList.remove('hidden');
      }
    } catch (e) {
      console.warn('V8 Warning: Stats calculation incomplete, visibility maintained.');
    }

    // [PRIORITY 3] Permanent History Locking
    updateHistoryItem(currentJobId, 'completed', result);
    renderHistory();

    // Final log entry
    const time = result && result.duration ? (result.duration / 1000).toFixed(1) : 'unknown';
    addLogEntry('done', `Finished in ${time}s — Suite Masterwork Locked.`);
  }

  // ===== Clone Error =====
  function onCloneError(errorMsg) {
    if (isCloneFinished) return;
    isCloneFinished = true;
    setLoading(false);
    statusText.textContent = 'Clone failed';
    statusIndicator.classList.add('error');
    addLogEntry('error', errorMsg);
    showError(errorMsg);
    updateHistoryItem(currentJobId, 'failed');
  }

  // ===== Action Buttons =====
  downloadBtn.addEventListener('click', () => {
    if (!currentJobId) return;
    const url = `/api/download/${currentJobId}`;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });


  previewBtn.addEventListener('click', () => {
    if (!currentJobId) return;
    previewSection.classList.remove('hidden');
    previewUrl.textContent = urlInput.value;
    previewIframe.src = `/api/preview/${currentJobId}/index.html`;
    previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  previewLaunchBtn.addEventListener('click', () => {
    if (!currentJobId) return;
    window.open(`/api/preview/${currentJobId}/index.html`, '_blank');
  });

  previewClose.addEventListener('click', () => {
    previewSection.classList.add('hidden');
    previewIframe.src = '';
  });

  newCloneBtn.addEventListener('click', () => {
    resetAll();
    urlInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ===== Clear All History & Files =====
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure? This will delete all files on the server and clear your history. This cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/reset', { method: 'POST' });
      
      if (!response.ok) {
        throw new Error('Failed to reset server data');
      }

      // Clear local storage
      localStorage.removeItem('sitecloner_history');
      
      // Reset UI
      resetAll();
      renderHistory();
      
      showSuccess('All data and files have been cleared.');
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });


  // ===== History =====
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('sitecloner_history') || '[]');
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem('sitecloner_history', JSON.stringify(history.slice(0, 20)));
  }

  function addToHistory(item) {
    const history = loadHistory();
    // Remove duplicate
    const idx = history.findIndex(h => h.id === item.id);
    if (idx >= 0) history.splice(idx, 1);
    history.unshift(item);
    saveHistory(history);
    renderHistory();
  }

  function updateHistoryItem(jobId, status, result = null) {
    const history = loadHistory();
    const item = history.find(h => h.id === jobId);
    if (item) {
      item.status = status;
      if (result) {
        item.stats = result.stats;
        item.duration = result.duration;
      }
    }
    saveHistory(history);
    renderHistory();
  }

  async function renderHistory() {
    try {
      const response = await fetch('/api/jobs');
      const history = await response.json();

      if (history.length === 0) {
        historyEmpty.classList.remove('hidden');
        document.querySelectorAll('.history-item').forEach(el => el.remove());
        return;
      }

      historyEmpty.classList.add('hidden');
      document.querySelectorAll('.history-item').forEach(el => el.remove());

      for (const item of history) {
        // Heartbeat Handshake (v2.14): If the current job matches and server says it's completed, unlock the premium action buttons
        if (item.id === currentJobId && item.status === 'completed' && !isCloneFinished) {
          onCloneComplete(item.result, item.url);
        }

        const el = document.createElement('div');
        el.className = 'history-item';
        el.setAttribute('data-job-id', item.id);
        el.innerHTML = `
          <div class="history-item-icon">🌐</div>
          <div class="history-item-info">
            <div class="history-item-url">${escapeHTML(item.url)}</div>
            <div class="history-item-meta">${formatDate(item.createdAt)}${item.duration ? ' · ' + (item.duration / 1000).toFixed(1) + 's' : ''}</div>
          </div>
          <span class="history-item-status ${item.status}">${item.status}</span>
          <button class="history-purge-btn" title="Purge Clone From Record" data-id="${item.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
        `;

        el.addEventListener('click', (e) => {
          if (e.target.closest('.history-purge-btn')) return;
          if (item.status === 'completed') {
            currentJobId = item.id;
            urlInput.value = item.url;
            onCloneComplete(item.result, item.url);
          }
        });

        const purgeBtn = el.querySelector('.history-purge-btn');
        purgeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Surgical Purge: Are you absolute sure you want to delete this clone and all its files?')) {
            await deleteJob(item.id);
          }
        });

        historyList.appendChild(el);
      }
    } catch (err) {
      console.error('History Sync Failed:', err);
    }
  }

  /**
   * Surgical Purge: Delete a single job.
   */
  async function deleteJob(jobId) {
    if (!jobId) return;
    const cleanId = jobId.trim();
    try {
      const response = await fetch(`/api/job/${cleanId}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (data.success || response.status === 404) {
        // Ghost-Purge Resilience (v2.6): Remove from UI even if already gone from server
        renderHistory();
      } else {
        showError(data.error || 'Failed to purge job');
      }
    } catch (err) {
      showError('Surgical Purge Failed: ' + err.message);
    }
  }

  // ===== Utility Functions =====
  function setLoading(loading) {
    if (loading) {
      cloneBtn.classList.add('loading');
      urlInput.disabled = true;
    } else {
      cloneBtn.classList.remove('loading');
      urlInput.disabled = false;
    }
  }

  function resetProgress() {
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    statusText.textContent = 'Initializing...';
    statusIndicator.classList.remove('done', 'error');
    progressLog.innerHTML = '';
    statsGrid.classList.add('hidden');
    
    // V11: Neural Stat Reset
    if (statAI) statAI.textContent = '0';
    if (aiStatCard) aiStatCard.classList.remove('active-ai');
    
    removeErrors();
  }

  function resetAll() {
    resetProgress();
    progressSection.classList.add('hidden');
    actionsSection.classList.add('hidden');
    previewSection.classList.add('hidden');
    previewIframe.src = '';
    currentJobId = null;
  }

  function showError(msg) {
    removeErrors();
    const el = document.createElement('div');
    el.className = 'error-message';
    el.textContent = msg;
    const cloneSection = document.getElementById('clone-section');
    cloneSection.appendChild(el);

    // Auto-remove after 8 seconds
    setTimeout(() => el.remove(), 8000);
  }

  function removeErrors() {
    document.querySelectorAll('.error-message').forEach(el => el.remove());
  }

  function showSuccess(msg) {
    removeErrors();
    const el = document.createElement('div');
    el.className = 'success-message';
    el.textContent = msg;
    const cloneSection = document.getElementById('clone-section');
    cloneSection.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }


  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Initialize =====
  renderHistory();

  // Focus input on page load
  urlInput.focus();

  // Add enter-key ripple effect
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      cloneBtn.style.transform = 'scale(0.97)';
      setTimeout(() => cloneBtn.style.transform = '', 150);
    }
  });

  // Add URL paste detection — auto-submit on paste of valid URL
  urlInput.addEventListener('paste', (e) => {
    setTimeout(() => {
      const val = urlInput.value.trim();
      try {
        new URL(val);
        // Subtle visual feedback that it's a valid URL
        urlInput.style.borderColor = 'var(--color-success)';
        setTimeout(() => urlInput.style.borderColor = '', 1000);
      } catch {}
    }, 100);
  });

})();
