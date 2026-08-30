    (function () {
      const STORAGE_KEY = 'macroTracker.entries.v1';
      const SETTINGS_KEY = 'macroTracker.settings.v1';
      const GH_TOKEN_KEY = 'macroTracker.ghToken.v1';
      const GH_REPO = 'mriostamez/mriostamez.github.io';
      const CSV_FILE_PATH = 'data.csv';

      let csvFileHandle = null;

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

      async function syncToGitHub(csvContent) {
        const token = localStorage.getItem(GH_TOKEN_KEY);
        if (!token) return;

        try {
          const url = `https://api.github.com/repos/${GH_REPO}/contents/${CSV_FILE_PATH}`;
          let sha = null;
          try {
            const getRes = await fetch(url, {
              headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
            });
            if (getRes.ok) {
              const getData = await getRes.json();
              sha = getData.sha;
            }
          } catch (e) { }

          const base64Content = btoa(unescape(encodeURIComponent(csvContent)));

          const bodyData = {
            message: 'Update data.csv via Daily Macro Tracker',
            content: base64Content,
            sha: sha || undefined
          };

          const putRes = await fetch(url, {
            method: 'PUT',
            headers: {
              Authorization: `token ${token}`,
              'Content-Type': 'application/json',
              Accept: 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(bodyData)
          });

          if (putRes.ok) {
            toast('Synced data.csv to GitHub Repo');
          } else {
            console.warn('GitHub API sync returned status:', putRes.status);
          }
        } catch (err) {
          console.error('GitHub API sync failed:', err);
        }
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

        syncToGitHub(csv);
      }

      async function persistEntries(sourceEntries) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sourceEntries)); } catch (e) { }
        await saveCSVSnapshot(sourceEntries);
      }

      async function restoreEntries() {
        const local = loadEntries();
        try {
          const res = await fetch(`./${CSV_FILE_PATH}?t=${Date.now()}`);
          if (res.ok) {
            const text = await res.text();
            const repo = entriesFromCSV(text);
            // Local edits win; repo fills in dates the local copy lacks.
            // Prevents the committed CSV from wiping unsynced browser edits on reload.
            const merged = Object.assign({}, repo, local);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) { }
            return merged;
          }
        } catch (err) {
          console.warn('Failed to fetch data.csv from repo:', err);
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
        carbs: { goal: 180, min: 175, max: 185 },
        fat: { goal: 60, min: 55, max: 65 },
        protein: { goal: 185, min: 180, max: 190 },
        calories: { goal: 2000, min: 1900, max: 2100 },
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
          return s ? Object.assign({}, DEFAULT_SETTINGS, s) : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
      }
      function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

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
        saveEntries(entries)
          .then(() => {
            toast(`Saved ${fmtDisplayDate(iso)}`);
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
          saveEntries(entries)
            .then(() => {
              toast(`Deleted ${fmtDisplayDate(iso)}`);
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
      function renderSettings() {
        const grid = $('settingsGrid');
        if (grid) {
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

        const tokenInput = $('ghTokenInput');
        if (tokenInput && document.activeElement !== tokenInput) {
          tokenInput.value = localStorage.getItem(GH_TOKEN_KEY) || '';
        }
      }

      const saveSettingsBtn = $('saveSettingsBtn');
      if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
          document.querySelectorAll('.settings-card[data-macro]').forEach(card => {
            const key = card.getAttribute('data-macro');
            settings[key] = {
              goal: parseFloat(card.querySelector('.s-goal').value) || 0,
              min: parseFloat(card.querySelector('.s-min').value) || 0,
              max: parseFloat(card.querySelector('.s-max').value) || 0,
            };
          });
          saveSettings(settings);
          toast('Goals saved');
          renderAll();
        });
      }

      const saveGHTokenBtn = $('saveGHTokenBtn');
      if (saveGHTokenBtn) {
        saveGHTokenBtn.addEventListener('click', () => {
          const val = $('ghTokenInput').value.trim();
          if (val) {
            localStorage.setItem(GH_TOKEN_KEY, val);
            toast('GitHub Token saved');
            syncToGitHub(csvFromEntries(entries));
          } else {
            localStorage.removeItem(GH_TOKEN_KEY);
            toast('GitHub Token cleared');
          }
        });
      }

      const clearGHTokenBtn = $('clearGHTokenBtn');
      if (clearGHTokenBtn) {
        clearGHTokenBtn.addEventListener('click', () => {
          $('ghTokenInput').value = '';
          localStorage.removeItem(GH_TOKEN_KEY);
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
          entries = await restoreEntries();
          renderAll();
        } catch (err) {
          console.error('Persistence initialization failed:', err);
          renderAll();
        }
      }

      initPersistence();
    })();
