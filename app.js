    (function () {
      const STORAGE_KEY = 'macroTracker.entries.v1';
      const SETTINGS_KEY = 'macroTracker.settings.v1';
      const GH_TOKEN_KEY = 'macroTracker.ghToken.v1';
      const TOMBSTONES_KEY = 'macroTracker.tombstones.v1';
      const GH_REPO = 'mriostamez/mriostamez.github.io';
      const CSV_FILE_PATH = 'data.csv';
      const GOALS_FILE_PATH = 'goals.json';

      let csvFileHandle = null;

      // ---------- Tombstone tracking for robust deletions ----------
      function loadTombstones() {
        try { return JSON.parse(localStorage.getItem(TOMBSTONES_KEY)) || []; } catch (e) { return []; }
      }
      function addTombstone(iso) {
        try {
          const stones = new Set(loadTombstones());
          stones.add(iso);
          localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(Array.from(stones)));
        } catch (e) { }
      }
      function removeTombstone(iso) {
        try {
          const stones = new Set(loadTombstones());
          stones.delete(iso);
          localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(Array.from(stones)));
        } catch (e) { }
      }
      function clearTombstones() {
        try { localStorage.removeItem(TOMBSTONES_KEY); } catch (e) { }
      }

      // ---------- IndexedDB storage for File System handle ----------
      const DB_NAME = 'MacroTrackerDB';
      const STORE_NAME = 'handles';

      function openDB() {
        return new Promise((resolve, reject) => {
          if (!('indexedDB' in window)) return reject(new Error('No indexedDB'));
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }

      async function storeFileHandle(handle) {
        try {
          const db = await openDB();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(handle, 'csvHandle');
        } catch (e) { }
      }

      async function getStoredFileHandle() {
        try {
          const db = await openDB();
          return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get('csvHandle');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          });
        } catch (e) { return null; }
      }

      // ---------- UI Sync Status Feedback ----------
      function updateSyncStatusUI(state, message) {
        document.querySelectorAll('#ghSyncStatus').forEach(el => {
          el.className = `sync-status-pill ${state}`;
          const textEl = el.querySelector('.sync-text');
          const dot = el.querySelector('.sync-dot');
          if (dot) {
            if (state === 'syncing') dot.classList.add('pulse');
            else dot.classList.remove('pulse');
          }
          if (textEl) {
            if (state === 'connected') textEl.textContent = 'GitHub Synced';
            else if (state === 'syncing') textEl.textContent = 'Syncing...';
            else if (state === 'error') textEl.textContent = 'Sync Error';
            else textEl.textContent = 'Local Only';
          }
        });

        const msgEl = $('ghSyncMsg');
        if (msgEl) {
          msgEl.textContent = message || '';
          msgEl.className = `sync-msg ${state === 'connected' ? 'good' : (state === 'error' ? 'bad' : 'warn')}`;
        }
      }

      async function verifyGitHubToken(token) {
        if (!token) {
          updateSyncStatusUI('local', 'Local storage only — paste token to enable GitHub sync.');
          return { valid: false, reason: 'empty' };
        }
        updateSyncStatusUI('syncing', 'Verifying GitHub token & permissions...');
        try {
          const userRes = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
          });
          if (!userRes.ok) {
            const err = userRes.status === 401 ? 'Invalid or expired token (401)' : `Auth error (${userRes.status})`;
            updateSyncStatusUI('error', err);
            return { valid: false, status: userRes.status, error: err };
          }
          const userData = await userRes.json();
          const login = userData.login;

          // Check repo push permission
          const repoRes = await fetch(`https://api.github.com/repos/${GH_REPO}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
          });
          if (!repoRes.ok) {
            const err = `Cannot access repo ${GH_REPO} (${repoRes.status}). Verify token repo permissions.`;
            updateSyncStatusUI('error', err);
            return { valid: false, status: repoRes.status, error: err };
          }
          const repoData = await repoRes.json();
          if (repoData.permissions && !repoData.permissions.push) {
            const err = 'Token lacks write (push) permission to this repository.';
            updateSyncStatusUI('error', err);
            return { valid: false, reason: 'no_push', error: err };
          }

          updateSyncStatusUI('connected', `Connected as @${login} — auto-sync active on main branch.`);
          return { valid: true, user: login };
        } catch (err) {
          updateSyncStatusUI('error', `Network error: ${err.message}`);
          return { valid: false, error: err.message };
        }
      }

      function csvFromEntries(sourceEntries) {
        const dates = Object.keys(sourceEntries).sort((a, b) => a.localeCompare(b));
        const lines = ['Date,Calories,Carbs,Fat,Protein'];
        dates.forEach(iso => {
          const e = sourceEntries[iso] || {};
          lines.push([
            iso,
            e.calories ?? '',
            e.carbs ?? '',
            e.fat ?? '',
            e.protein ?? ''
          ].join(','));
        });
        return lines.join('\n') + '\n';
      }

      function entriesFromCSV(csvText) {
        const result = {};
        if (!csvText) return result;
        const lines = csvText.split(/\r?\n/).filter(l => l.trim().length);
        if (lines.length <= 1) return result;

        lines.slice(1).forEach(line => {
          const [date, cal, carb, fat, protein] = line.split(',');
          if (!date) return;
          const iso = date.trim().slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
          result[iso] = {
            calories: cal !== undefined && cal !== '' && !isNaN(cal) ? parseFloat(cal) : '',
            carbs: carb !== undefined && carb !== '' && !isNaN(carb) ? parseFloat(carb) : '',
            fat: fat !== undefined && fat !== '' && !isNaN(fat) ? parseFloat(fat) : '',
            protein: protein !== undefined && protein !== '' && !isNaN(protein) ? parseFloat(protein) : '',
          };
        });
        return result;
      }

      async function commitFileToGitHub(filePath, fileContentUtf8, commitMessage) {
        const token = localStorage.getItem(GH_TOKEN_KEY);
        if (!token) {
          updateSyncStatusUI('local', 'Saved locally (no GitHub token configured).');
          return { success: false, reason: 'no_token' };
        }

        updateSyncStatusUI('syncing', `Pushing ${filePath} to GitHub...`);
        const url = `https://api.github.com/repos/${GH_REPO}/contents/${filePath}`;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // 1. Fetch current file SHA with cache-busting
            let sha = null;
            try {
              const getRes = await fetch(`${url}?t=${Date.now()}`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/vnd.github.v3+json'
                },
                cache: 'no-store'
              });
              if (getRes.ok) {
                const getData = await getRes.json();
                sha = getData.sha;
              } else if (getRes.status === 401) {
                updateSyncStatusUI('error', 'GitHub Token is invalid or expired (401).');
                toast('GitHub Sync Failed: Invalid or expired token');
                return { success: false, status: 401 };
              } else if (getRes.status === 403) {
                updateSyncStatusUI('error', 'Token lacks write permission to repo (403).');
                toast('GitHub Sync Failed: Permission denied');
                return { success: false, status: 403 };
              }
            } catch (err) {
              console.warn(`Error fetching ${filePath} SHA:`, err);
            }

            // 2. Base64 encode file content safely
            const base64Content = btoa(unescape(encodeURIComponent(fileContentUtf8)));

            const bodyData = {
              message: commitMessage || `Update ${filePath} via Daily Macro Tracker`,
              content: base64Content,
              sha: sha || undefined
            };

            // 3. Send PUT request
            const putRes = await fetch(url, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/vnd.github.v3+json'
              },
              body: JSON.stringify(bodyData)
            });

            if (putRes.ok) {
              updateSyncStatusUI('connected', `Synced ${filePath} to GitHub repository.`);
              return { success: true };
            }

            // Handle 409 Conflict with auto-retry
            if (putRes.status === 409) {
              console.warn(`409 Conflict committing ${filePath}, attempt ${attempt}/${maxRetries}. Retrying with fresh SHA...`);
              if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 500 * attempt));
                continue;
              }
            }

            const errorText = await putRes.text();
            let errMsg = `GitHub API error (${putRes.status})`;
            try {
              const errJson = JSON.parse(errorText);
              if (errJson.message) errMsg = errJson.message;
            } catch (e) { }

            updateSyncStatusUI('error', `GitHub sync failed: ${errMsg}`);
            toast(`GitHub sync failed: ${errMsg}`);
            return { success: false, status: putRes.status, error: errMsg };
          } catch (err) {
            console.error(`GitHub commit exception (${filePath}):`, err);
            if (attempt === maxRetries) {
              updateSyncStatusUI('error', `Network error: ${err.message}`);
              toast(`GitHub sync error: ${err.message}`);
              return { success: false, error: err.message };
            }
            await new Promise(r => setTimeout(r, 500 * attempt));
          }
        }

        return { success: false, reason: 'retries_exhausted' };
      }

      async function syncToGitHub(csvContent) {
        return await commitFileToGitHub(CSV_FILE_PATH, csvContent, 'Update data.csv via Daily Macro Tracker');
      }

      async function saveCSVSnapshot(sourceEntries) {
        const csv = csvFromEntries(sourceEntries);

        if (csvFileHandle) {
          try {
            const writable = await csvFileHandle.createWritable();
            await writable.write(csv);
            await writable.close();
          } catch (err) {
            console.warn('File handle write failed:', err);
            csvFileHandle = null;
          }
        }

        return await syncToGitHub(csv);
      }

      async function persistEntries(sourceEntries) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sourceEntries)); } catch (e) { }
        return await saveCSVSnapshot(sourceEntries);
      }

      async function restoreEntries() {
        const local = loadEntries();
        const tombstones = new Set(loadTombstones());
        const token = localStorage.getItem(GH_TOKEN_KEY);
        let repoCSV = null;

        // If a GitHub token is configured, fetch directly from GitHub Contents API
        // to bypass the 1-3 minute delay of GitHub Pages build & CDN cache!
        if (token) {
          try {
            const url = `https://api.github.com/repos/${GH_REPO}/contents/${CSV_FILE_PATH}?t=${Date.now()}`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
              cache: 'no-store'
            });
            if (res.ok) {
              const data = await res.json();
              if (data && data.content) {
                repoCSV = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
              }
            }
          } catch (err) {
            console.warn('Direct GitHub API fetch failed, falling back to static pages file:', err);
          }
        }

        // Fallback to static ./data.csv if GitHub API was not used or failed
        if (!repoCSV) {
          try {
            const res = await fetch(`./${CSV_FILE_PATH}?t=${Date.now()}`, { cache: 'no-store' });
            if (res.ok) {
              repoCSV = await res.text();
            }
          } catch (err) {
            console.warn('Failed to fetch data.csv from repo/pages:', err);
          }
        }

        if (repoCSV) {
          const repo = entriesFromCSV(repoCSV);
          // Never resurrect dates that were explicitly deleted locally
          tombstones.forEach(iso => {
            delete repo[iso];
          });
          // Local edits win; repo fills in dates the local copy lacks
          const merged = Object.assign({}, repo, local);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) { }
          return merged;
        }

        return local;
      }

      async function chooseCSVFile() {
        if (!('showOpenFilePicker' in window) && !('showSaveFilePicker' in window)) {
          toast('Direct file saving unavailable in this browser; use Export CSV.');
          return;
        }

        try {
          if ('showOpenFilePicker' in window) {
            const [handle] = await window.showOpenFilePicker({
              types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }]
            });
            csvFileHandle = handle;
            await storeFileHandle(handle);
            const file = await csvFileHandle.getFile();
            const text = await file.text();
            const loaded = entriesFromCSV(text);
            if (Object.keys(loaded).length > 0) {
              entries = loaded;
              await persistEntries(entries);
              renderAll();
            }
          } else {
            csvFileHandle = await window.showSaveFilePicker({
              suggestedName: 'data.csv',
              types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }]
            });
            await storeFileHandle(csvFileHandle);
            await saveCSVSnapshot(entries);
          }
          toast('CSV persistence connected');
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            console.error(err);
            toast('Could not connect the CSV file');
          }
        }
      }

      const MACROS = [
        { key: 'calories', label: 'Calories', unit: 'kcal', color: '--kcal' },
        { key: 'carbs', label: 'Carbs', unit: 'g', color: '--carb' },
        { key: 'fat', label: 'Fat', unit: 'g', color: '--fat' },
        { key: 'protein', label: 'Protein', unit: 'g', color: '--protein' },
      ];

      const DEFAULT_SETTINGS = {
        carbs: { goal: 160, min: 155, max: 165 },
        fat: { goal: 55, min: 50, max: 60 },
        protein: { goal: 185, min: 180, max: 190 },
        calories: { goal: 1875, min: 1775, max: 1975 },
      };

      function loadEntries() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
      }

      function saveEntries(nextEntries) {
        return persistEntries(nextEntries);
      }

      function loadSettings() {
        try {
          const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
          let base = s ? Object.assign({}, DEFAULT_SETTINGS, s) : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

          // Load committed goals.json (source of truth across browsers/sessions)
          const fileGoals = localStorage.getItem('macroTracker.goalsFile.v1');
          if (!fileGoals) {
            // Try a fresh fetch on first load after deploy
            loadGoalsFile().then(fetched => {
              if (fetched) {
                let merged = Object.assign({}, DEFAULT_SETTINGS, fetched);
                saveSettings(merged);
                settings = merged;
                renderAll();
              }
            }).catch(() => {});
          } else {
            try {
              const parsed = JSON.parse(fileGoals);
              if (parsed && parsed.goals) {
                base = Object.assign({}, base, parsed.goals);
              }
            } catch (e) { }
          }

          return base;
        } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
      }
      function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

      async function loadGoalsFile() {
        const token = localStorage.getItem(GH_TOKEN_KEY);
        if (token) {
          try {
            const url = `https://api.github.com/repos/${GH_REPO}/contents/${GOALS_FILE_PATH}?t=${Date.now()}`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
              cache: 'no-store'
            });
            if (res.ok) {
              const data = await res.json();
              if (data && data.content) {
                const parsed = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\s/g, '')))));
                if (parsed && parsed.goals) return parsed.goals;
              }
            }
          } catch (e) {
            console.warn('Direct GitHub API fetch for goals.json failed, falling back:', e);
          }
        }
        try {
          const res = await fetch(`./${GOALS_FILE_PATH}?t=${Date.now()}`, { cache: 'no-store' });
          if (!res.ok) return null;
          const data = await res.json();
          if (data && data.goals) return data.goals;
        } catch (e) { }
        return null;
      }

      async function saveGoalsFile(nextSettings) {
        const goals = {};
        for (const key of Object.keys(nextSettings)) {
          goals[key] = { goal: nextSettings[key].goal, min: nextSettings[key].min, max: nextSettings[key].max };
        }
        const payload = { version: 1, updatedAt: new Date().toISOString(), goals };

        try { localStorage.setItem('macroTracker.goalsFile.v1', JSON.stringify(payload)); } catch (e) { }

        const jsonContent = JSON.stringify(payload, null, 2);
        return await commitFileToGitHub(GOALS_FILE_PATH, jsonContent, 'Update goals.json via Daily Macro Tracker');
      }

      let entries = loadEntries();
      let settings = loadSettings();

      function toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toast._h);
        toast._h = setTimeout(() => t.classList.remove('show'), 1800);
      }

      function todayISO() {
        const d = new Date();
        return d.toISOString().slice(0, 10);
      }

      function fmtDisplayDate(iso) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
      }

      function estimateCalories(carb, fat, protein) {
        return Math.round((carb || 0) * 4 + (protein || 0) * 4 + (fat || 0) * 9);
      }

      function statusFor(macroKey, value) {
        const r = settings[macroKey];
        if (!r || value === undefined || value === null || value === '') return null;
        
        if (macroKey !== 'calories') {
          const diff = Math.abs(value - r.goal);
          if (diff <= 5) return 'good';
          if (diff <= 10) return 'warn';
          return 'bad';
        }

        if (value < r.min) return 'warn';
        if (value > r.max) return 'bad';
        return 'good';
      }

      function badge(macroKey, value) {
        if (value === undefined || value === null || value === '') return '<span style="color:var(--text-dim)">—</span>';
        const s = statusFor(macroKey, value);
        const cls = s || 'warn';
        return `<span class="badge ${cls}">${value}</span>`;
      }

      function $(id) { return document.getElementById(id); }

      // ---------- Entry form ----------
      const form = $('entryForm');
      const dateInput = $('f-date');
      const calInput = $('f-cal');
      const carbInput = $('f-carb');
      const fatInput = $('f-fat');
      const proteinInput = $('f-protein');
      const estimateLine = $('estimateLine');

      // Entry form only exists on the dashboard page; guard so this script is safe on fullhistory.html too.
      const hasEntryForm = !!(form && dateInput);
      if (hasEntryForm) {

      dateInput.value = todayISO();

      function updateEstimate() {
        const carb = parseFloat(carbInput.value) || 0;
        const fat = parseFloat(fatInput.value) || 0;
        const protein = parseFloat(proteinInput.value) || 0;
        if (!carbInput.value && !fatInput.value && !proteinInput.value) {
          estimateLine.innerHTML = '';
          return;
        }
        const est = estimateCalories(carb, fat, protein);
        estimateLine.innerHTML = `Estimated from macros: <strong>${est} kcal</strong> (4·carb + 4·protein + 9·fat)` +
          (calInput.value ? ` — logged calories: <strong>${calInput.value}</strong>` : ' — leave Calories blank to auto-fill this.');
      }
      [carbInput, fatInput, proteinInput, calInput].forEach(el => el.addEventListener('input', updateEstimate));

      function loadDateIntoForm(iso) {
        const e = entries[iso];
        dateInput.value = iso;
        calInput.value = e ? e.calories : '';
        carbInput.value = e ? e.carbs : '';
        fatInput.value = e ? e.fat : '';
        proteinInput.value = e ? e.protein : '';
        updateEstimate();
        window.scrollTo({ top: document.getElementById('entry').offsetTop - 20, behavior: 'smooth' });
      }

      document.getElementById('clearFormBtn').addEventListener('click', () => {
        calInput.value = ''; carbInput.value = ''; fatInput.value = ''; proteinInput.value = '';
        estimateLine.innerHTML = '';
      });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const iso = dateInput.value;
        if (!iso) { toast('Pick a date first'); return; }
        const carb = carbInput.value === '' ? undefined : parseFloat(carbInput.value);
        const fat = fatInput.value === '' ? undefined : parseFloat(fatInput.value);
        const protein = proteinInput.value === '' ? undefined : parseFloat(proteinInput.value);
        let cal = calInput.value === '' ? undefined : parseFloat(calInput.value);
        if (cal === undefined && (carb !== undefined || fat !== undefined || protein !== undefined)) {
          cal = estimateCalories(carb, fat, protein);
        }
        entries[iso] = { calories: cal ?? '', carbs: carb ?? '', fat: fat ?? '', protein: protein ?? '' };
        removeTombstone(iso);
        saveEntries(entries)
          .then((syncRes) => {
            if (syncRes && syncRes.success) {
              toast(`Saved & synced ${fmtDisplayDate(iso)} to GitHub`);
            } else if (syncRes && syncRes.reason === 'no_token') {
              toast(`Saved ${fmtDisplayDate(iso)} locally (GitHub sync not set)`);
            } else {
              toast(`Saved ${fmtDisplayDate(iso)} locally`);
            }
            renderAll();
          })
          .catch(err => {
            console.error(err);
            toast('Save failed');
          });
      });

      }

      // ---------- Recent 7-day table ----------
      function sortedDates(desc = true) {
        return Object.keys(entries).sort((a, b) => desc ? (a < b ? 1 : -1) : (a < b ? -1 : 1));
      }

      function rowHTML(iso, e, withDelete) {
        return `<tr class="editable-row" data-date="${iso}">
      <td>${fmtDisplayDate(iso)}</td>
      <td>${badge('calories', e.calories)}</td>
      <td>${badge('carbs', e.carbs)}</td>
      <td>${badge('fat', e.fat)}</td>
      <td>${badge('protein', e.protein)}</td>
      <td class="row-actions"><button class="danger" data-delete="${iso}">Delete</button></td>
    </tr>`;
      }

      function renderRecent() {
        const body = $('recentBody');
        if (!body) return; // only on dashboard
        const dates = sortedDates().slice(0, 7);
        const empty = $('recentEmpty');
        if (dates.length === 0) { body.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        body.innerHTML = dates.map(iso => rowHTML(iso, entries[iso])).join('');
      }

      // ---------- Full history + filter ----------
      let filterRange = null;
      function renderHistory() {
        const body = $('historyBody');
        if (!body) return; // only on fullhistory.html
        let dates = sortedDates();
        if (filterRange) {
          dates = dates.filter(d => d >= filterRange.start && d <= filterRange.end);
        }
        const empty = $('historyEmpty');
        if (dates.length === 0) { body.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        body.innerHTML = dates.map(iso => rowHTML(iso, entries[iso])).join('');
      }

      const applyFilterBtn = $('applyFilter');
      if (applyFilterBtn) {
        applyFilterBtn.addEventListener('click', () => {
          const s = $('filterStart').value;
          const e = $('filterEnd').value;
          if (!s || !e) { toast('Pick both dates'); return; }
          filterRange = { start: s, end: e };
          renderHistory();
        });
      }
      const resetFilterBtn = $('resetFilter');
      if (resetFilterBtn) {
        resetFilterBtn.addEventListener('click', () => {
          filterRange = null;
          $('filterStart').value = '';
          $('filterEnd').value = '';
          renderHistory();
        });
      }

      // Row click to load into form / delete
      document.addEventListener('click', function (ev) {
        const del = ev.target.closest('[data-delete]');
        if (del) {
          ev.stopPropagation();
          const iso = del.getAttribute('data-delete');
          delete entries[iso];
          addTombstone(iso);
          saveEntries(entries)
            .then((syncRes) => {
              if (syncRes && syncRes.success) {
                clearTombstones();
                toast(`Deleted ${fmtDisplayDate(iso)} (synced to GitHub)`);
              } else {
                toast(`Deleted ${fmtDisplayDate(iso)} locally`);
              }
              renderAll();
            })
            .catch(err => {
              console.error(err);
              toast('Delete failed');
            });
          return;
        }
        const row = ev.target.closest('.editable-row');
        if (row) {
          if (typeof loadDateIntoForm === 'function') loadDateIntoForm(row.getAttribute('data-date'));
        }
      });

      // ---------- Settings ----------
      function readSettingsFromDOM() {
        const grid = $('settingsGrid');
        if (!grid) return settings;
        grid.querySelectorAll('.settings-card[data-macro]').forEach(card => {
          const key = card.getAttribute('data-macro');
          if (settings[key]) {
            const goalEl = card.querySelector('.s-goal');
            const minEl = card.querySelector('.s-min');
            const maxEl = card.querySelector('.s-max');
            const g = goalEl && goalEl.value !== '' ? parseFloat(goalEl.value) : settings[key].goal;
            const mn = minEl && minEl.value !== '' ? parseFloat(minEl.value) : settings[key].min;
            const mx = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : settings[key].max;
            settings[key] = {
              goal: !isNaN(g) ? g : settings[key].goal,
              min: !isNaN(mn) ? mn : settings[key].min,
              max: !isNaN(mx) ? mx : settings[key].max,
            };
          }
        });
        saveSettings(settings);
        return settings;
      }

      function renderSettings() {
        const grid = $('settingsGrid');
        if (grid) {
          const activeEl = document.activeElement;
          const isTypingInGrid = activeEl && grid.contains(activeEl);

          if (!isTypingInGrid) {
            grid.innerHTML = MACROS.map(m => {
              const r = settings[m.key] || { goal: '', min: '', max: '' };
              return `<div class="settings-card" data-macro="${m.key}">
          <div class="macro-name" style="color:var(${m.color})">${m.label} (${m.unit})</div>
          <div class="mini-fields">
            <div class="field"><label>Goal</label><input type="number" class="s-goal" value="${r.goal}"></div>
            <div class="field"><label>Min</label><input type="number" class="s-min" value="${r.min}"></div>
            <div class="field"><label>Max</label><input type="number" class="s-max" value="${r.max}"></div>
          </div>
        </div>`;
            }).join('');
          }
        }

        const tokenInput = $('ghTokenInput');
        if (tokenInput && document.activeElement !== tokenInput) {
          tokenInput.value = localStorage.getItem(GH_TOKEN_KEY) || '';
        }
      }

      const settingsGrid = $('settingsGrid');
      if (settingsGrid) {
        settingsGrid.addEventListener('input', () => {
          readSettingsFromDOM();
        });
      }

      const saveSettingsBtn = $('saveSettingsBtn');
      if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
          readSettingsFromDOM();
          toast('Saving goals...');
          const goalsRes = await saveGoalsFile(settings);
          if (goalsRes && goalsRes.success) {
            toast('Goals saved & synced to GitHub (goals.json)');
          } else {
            toast('Goals saved locally');
          }
          renderAll();
        });
      }

      const saveGHTokenBtn = $('saveGHTokenBtn');
      if (saveGHTokenBtn) {
        saveGHTokenBtn.addEventListener('click', async () => {
          const val = $('ghTokenInput').value.trim();
          if (val) {
            localStorage.setItem(GH_TOKEN_KEY, val);
            readSettingsFromDOM();
            toast('Testing GitHub token...');
            const verification = await verifyGitHubToken(val);
            if (verification.valid) {
              toast(`Connected as @${verification.user}! Syncing goals & data...`);
              const goalsRes = await saveGoalsFile(settings);
              const syncRes = await syncToGitHub(csvFromEntries(entries));
              if (syncRes && syncRes.success && goalsRes && goalsRes.success) {
                clearTombstones();
                toast('Token verified: goals.json & data.csv synced to GitHub!');
              } else if (goalsRes && goalsRes.success) {
                toast('goals.json synced to GitHub!');
              } else {
                toast('GitHub token verified and data synced!');
              }
              renderAll();
            } else {
              toast(`GitHub token test failed: ${verification.error || 'Invalid token'}`);
            }
          } else {
            localStorage.removeItem(GH_TOKEN_KEY);
            updateSyncStatusUI('local', 'Token removed (local storage only)');
            toast('GitHub Token cleared');
          }
        });
      }

      const syncNowBtn = $('syncNowBtn');
      if (syncNowBtn) {
        syncNowBtn.addEventListener('click', async () => {
          const token = localStorage.getItem(GH_TOKEN_KEY);
          if (!token) {
            toast('Please enter and save a GitHub token first');
            if ($('ghTokenInput')) $('ghTokenInput').focus();
            return;
          }
          readSettingsFromDOM();
          toast('Syncing data.csv & goals.json to GitHub...');
          const goalsRes = await saveGoalsFile(settings);
          const csvRes = await syncToGitHub(csvFromEntries(entries));
          if (csvRes && csvRes.success && goalsRes && goalsRes.success) {
            clearTombstones();
            toast('Synced data.csv and goals.json to GitHub!');
          } else if (goalsRes && goalsRes.success) {
            toast('Synced goals.json to GitHub!');
          } else if (csvRes && csvRes.success) {
            clearTombstones();
            toast('Synced data.csv to GitHub!');
          }
          renderAll();
        });
      }

      const clearGHTokenBtn = $('clearGHTokenBtn');
      if (clearGHTokenBtn) {
        clearGHTokenBtn.addEventListener('click', () => {
          if ($('ghTokenInput')) $('ghTokenInput').value = '';
          localStorage.removeItem(GH_TOKEN_KEY);
          updateSyncStatusUI('local', 'Token cleared (local storage only)');
          toast('GitHub Token cleared');
        });
      }

      // ---------- Charts ----------
      let calChart, macroChart;
      function renderCharts() {
        if (typeof Chart === 'undefined') {
          ['calChart', 'macroChart'].forEach(id => {
            const c = $(id);
            if (c && c.parentElement && !c.parentElement.querySelector('.chart-fallback')) {
              const p = document.createElement('div');
              p.className = 'chart-fallback empty-state';
              p.textContent = 'Charts couldn\'t load (no connection to the chart library). Everything else still works.';
              c.parentElement.appendChild(p);
              c.style.display = 'none';
            }
          });
          return;
        }
        const calCanvas = $('calChart');
        if (!calCanvas) return; // only on dashboard
        const dates = sortedDates(false).slice(-14);
        const labels = dates.map(d => d.slice(5));
        const calData = dates.map(d => entries[d].calories === '' ? null : entries[d].calories);
        const goalLine = dates.map(() => settings.calories.goal);

        const ctx1 = calCanvas.getContext('2d');
        if (calChart) calChart.destroy();
        calChart = new Chart(ctx1, {
          type: 'line',
          data: {
            labels, datasets: [
              { label: 'Calories', data: calData, borderColor: '#3a3733', backgroundColor: 'rgba(58,55,51,.06)', tension: .3, spanGaps: true, pointRadius: 3, fill: true },
              { label: 'Goal', data: goalLine, borderColor: '#2f8f5f', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
            ]
          },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#756f66', font: { family: 'JetBrains Mono', size: 11 } } } },
            scales: {
              x: { ticks: { color: '#756f66', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#e1ddd4' } },
              y: { ticks: { color: '#756f66', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#e1ddd4' } }
            }
          }
        });

        const last7 = sortedDates(false).slice(-7);
        function avg(key) {
          const vals = last7.map(d => entries[d][key]).filter(v => v !== undefined && v !== '' && v !== null);
          if (vals.length === 0) return 0;
          return Math.round(vals.reduce((a, b) => a + Number(b), 0) / vals.length);
        }
        const carbAvg = avg('carbs'), fatAvg = avg('fat'), proteinAvg = avg('protein');
        const totalAvgGrams = carbAvg + fatAvg + proteinAvg;

        const carbPct = totalAvgGrams ? Math.round((carbAvg / totalAvgGrams) * 100) : 0;
        const fatPct = totalAvgGrams ? Math.round((fatAvg / totalAvgGrams) * 100) : 0;
        const proteinPct = totalAvgGrams ? Math.round((proteinAvg / totalAvgGrams) * 100) : 0;

        const macroCanvas = $('macroChart');
        if (macroCanvas) {
          const ctx2 = macroCanvas.getContext('2d');
          if (macroChart) macroChart.destroy();
          macroChart = new Chart(ctx2, {
            type: 'doughnut',
            data: {
              labels: ['Carbs', 'Fat', 'Protein'],
              datasets: [{
                data: [carbAvg, fatAvg, proteinAvg],
                backgroundColor: ['#2f6fa8', '#b3791d', '#b83f57'],
                borderColor: '#ffffff',
                borderWidth: 2
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: {
                    color: '#756f66',
                    font: { family: 'JetBrains Mono', size: 11 },
                    padding: 12
                  }
                },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const val = context.raw || 0;
                      const pct = totalAvgGrams ? Math.round((val / totalAvgGrams) * 100) : 0;
                      const macroNames = ['Carbs', 'Fat', 'Protein'];
                      const name = macroNames[context.dataIndex] || context.label;
                      return ` ${name}: ${val}g (${pct}%)`;
                    }
                  }
                }
              }
            },
            plugins: [{
              id: 'sliceLabelsAndCenterText',
              afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                const { top, bottom, left, right } = chartArea;
                ctx.save();

                // Draw slice labels (grams & percentage) directly on each slice
                const meta = chart.getDatasetMeta(0);
                if (meta && meta.data) {
                  meta.data.forEach((element, index) => {
                    const val = chart.data.datasets[0].data[index];
                    if (!val || val <= 0) return;

                    const pct = totalAvgGrams ? Math.round((val / totalAvgGrams) * 100) : 0;
                    const { startAngle, endAngle, outerRadius, innerRadius, x, y } = element;
                    const angle = startAngle + (endAngle - startAngle) / 2;
                    const middleRadius = innerRadius + (outerRadius - innerRadius) / 2;

                    const labelX = x + Math.cos(angle) * middleRadius;
                    const labelY = y + Math.sin(angle) * middleRadius;

                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                    ctx.shadowBlur = 3;
                    ctx.font = '700 11px "JetBrains Mono", monospace';
                    ctx.fillText(`${val}g (${pct}%)`, labelX, labelY);
                    ctx.restore();
                  });
                }

                // Draw center total text inside doughnut hole
                const centerX = (left + right) / 2;
                const centerY = (top + bottom) / 2;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#201f1c';
                ctx.font = '700 15px "JetBrains Mono", monospace';
                ctx.fillText(`${totalAvgGrams}g`, centerX, centerY - 6);
                ctx.fillStyle = '#756f66';
                ctx.font = '500 10px "Inter", sans-serif';
                ctx.fillText('avg / day', centerX, centerY + 10);
                ctx.restore();
              }
            }]
          });
        }
      }

      // ---------- CSV export / import ----------
      const exportBtn = $('exportBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          const csv = csvFromEntries(entries);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `macro-tracker-${todayISO()}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast('Exported CSV');
        });
      }

      const connectCSVBtn = $('connectCSVBtn');
      if (connectCSVBtn) connectCSVBtn.addEventListener('click', chooseCSVFile);

      const importInput = $('importInput');
      if (importInput) {
        importInput.addEventListener('change', function (ev) {
          const file = ev.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function (e) {
            try {
              const imported = entriesFromCSV(e.target.result);
              const count = Object.keys(imported).length;
              entries = Object.assign({}, entries, imported);
              saveEntries(entries)
                .then(() => {
                  toast(`Imported ${count} rows`);
                  renderAll();
                })
                .catch(err => {
                  console.error(err);
                  toast('Import failed');
                });
            } catch (err) {
              toast('Import failed — check CSV format');
            }
            ev.target.value = '';
          };
          reader.readAsText(file);
        });
      }

      function renderAll() {
        renderRecent();
        renderHistory();
        renderSettings();
        renderCharts();
      }

      async function initPersistence() {
        try {
          // Initialize token verification & live UI status
          const token = localStorage.getItem(GH_TOKEN_KEY);
          if (token) {
            verifyGitHubToken(token);
          } else {
            updateSyncStatusUI('local', 'Local storage only — paste token in Settings to sync to GitHub');
          }

          // Restore local file handle from IndexedDB if available
          const storedHandle = await getStoredFileHandle();
          if (storedHandle) {
            try {
              const perm = await storedHandle.queryPermission({ mode: 'readwrite' });
              if (perm === 'granted') {
                csvFileHandle = storedHandle;
              }
            } catch (e) { }
          }

          // Sync fresh goals from GitHub / remote if available
          try {
            const remoteGoals = await loadGoalsFile();
            if (remoteGoals) {
              settings = Object.assign({}, DEFAULT_SETTINGS, settings, remoteGoals);
              saveSettings(settings);
            }
          } catch (e) { }

          entries = await restoreEntries();
          renderAll();
        } catch (err) {
          console.error('Persistence initialization failed:', err);
          renderAll();
        }
      }

      initPersistence();
    })();
