/* ===== Constants ===== */
const MAX_TIMERS = 10;
const STORAGE_KEY = 'sequenceTimerSavedSequences';

/* ===== State & DOM (initialized on DOMContentLoaded) ===== */
let state;
let dom;

/* ===== Initialization ===== */
document.addEventListener('DOMContentLoaded', () => {
    state = {
        timers: [createTimer()],
        currentIndex: 0,
        isRunning: false,
        isPaused: false,
        remaining: 0,
        totalForCurrent: 0,
        intervalId: null,
        savedSequences: []
    };

    dom = {
        timerDisplay: document.getElementById('timerDisplay'),
        progressBar: document.getElementById('progressBar'),
        timerInfo: document.getElementById('timerInfo'),
        sequenceDots: document.getElementById('sequenceDots'),
        timerList: document.getElementById('timerList'),
        timerHint: document.getElementById('timerHint'),
        sequenceList: document.getElementById('sequenceList'),
        sequencesEmpty: document.getElementById('sequencesEmpty'),
        sequenceNameInput: document.getElementById('sequenceNameInput'),
        btnStart: document.getElementById('btnStart'),
        btnCancel: document.getElementById('btnCancel'),
        btnReset: document.getElementById('btnReset'),
        btnAddTimer: document.getElementById('btnAddTimer'),
        btnSaveSequence: document.getElementById('btnSaveSequence'),
        display: document.querySelector('.display')
    };

    loadSavedSequences();
    render();
    bindEvents();
});

/* ===== Event Binding ===== */
function bindEvents() {
    dom.btnStart.addEventListener('click', handleStartPause);
    dom.btnCancel.addEventListener('click', handleCancelAll);
    dom.btnReset.addEventListener('click', handleCancelAndReset);
    dom.btnAddTimer.addEventListener('click', handleAddTimer);
    dom.btnSaveSequence.addEventListener('click', handleSaveSequence);

    /* Delegate events on the timer list */
    dom.timerList.addEventListener('input', handleTimerInput);
    dom.timerList.addEventListener('click', handleTimerListClick);

    /* Delegate events on the sequence list */
    dom.sequenceList.addEventListener('click', handleSequenceListClick);

    /* Allow Enter key to save sequence */
    dom.sequenceNameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            handleSaveSequence();
        }
    });
}

/* ===== Handlers ===== */
function handleStartPause() {
    if (state.isRunning && !state.isPaused) {
        pauseSequence();
    } else if (state.isPaused) {
        resumeSequence();
    } else {
        startSequence();
    }
}

function handleCancelAll() {
    cancelAll();
}

function handleCancelAndReset() {
    cancelAndReset();
}

function handleAddTimer() {
    if (state.timers.length >= MAX_TIMERS || state.isRunning) {
        return;
    }
    state.timers.push(createTimer());
    render();
}

function handleTimerInput(event) {
    const input = event.target;
    if (!input.classList.contains('timer-item__input')) {
        return;
    }
    const itemEl = input.closest('.timer-item');
    const timerId = itemEl.dataset.id;
    const field = input.dataset.field;
    let value = parseInt(input.value, 10) || 0;

    /* Clamp values */
    if (field === 'hours') {
        value = Math.max(0, Math.min(99, value));
    } else {
        value = Math.max(0, Math.min(59, value));
    }
    input.value = value;

    const timer = state.timers.find((t) => t.id === timerId);
    if (timer) {
        timer[field] = value;
    }
}

function handleTimerListClick(event) {
    const removeBtn = event.target.closest('.timer-item__remove');
    if (!removeBtn) {
        return;
    }
    if (state.timers.length <= 1 || state.isRunning) {
        return;
    }
    const itemEl = removeBtn.closest('.timer-item');
    const timerId = itemEl.dataset.id;
    state.timers = state.timers.filter((t) => t.id !== timerId);
    render();
}

function handleSaveSequence() {
    const name = dom.sequenceNameInput.value.trim();
    if (!name) {
        dom.sequenceNameInput.focus();
        return;
    }

    const sequenceData = state.timers.map((t) => ({
        hours: t.hours,
        minutes: t.minutes,
        seconds: t.seconds
    }));

    state.savedSequences.push({ name, timers: sequenceData });
    persistSavedSequences();
    dom.sequenceNameInput.value = '';
    renderSequences();
}

function handleSequenceListClick(event) {
    const btn = event.target.closest('.sequence-item__btn');
    if (!btn) {
        return;
    }
    const index = parseInt(btn.dataset.index, 10);

    if (btn.classList.contains('sequence-item__btn--load')) {
        loadSequence(index);
    } else if (btn.classList.contains('sequence-item__btn--delete')) {
        deleteSequence(index);
    }
}

/* ===== Timer Logic ===== */
function startSequence() {
    /* Validate at least one timer has time > 0 */
    const totalAll = state.timers.reduce((sum, t) => sum + timerToSeconds(t), 0);
    if (totalAll <= 0) {
        flashDisplay();
        return;
    }

    /* Find first non-zero timer */
    state.currentIndex = state.timers.findIndex((t) => timerToSeconds(t) > 0);
    if (state.currentIndex === -1) {
        return;
    }

    state.isRunning = true;
    state.isPaused = false;
    const current = state.timers[state.currentIndex];
    state.totalForCurrent = timerToSeconds(current);
    state.remaining = state.totalForCurrent;

    startInterval();
    render();
}

function pauseSequence() {
    state.isPaused = true;
    clearInterval(state.intervalId);
    state.intervalId = null;
    render();
}

function resumeSequence() {
    state.isPaused = false;
    startInterval();
    render();
}

function startInterval() {
    state.intervalId = setInterval(tick, 1000);
}

function tick() {
    state.remaining -= 1;

    if (state.remaining <= 0) {
        playBellSound();
        flashDisplay();

        /* Move to next timer */
        const nextIndex = findNextTimer(state.currentIndex + 1);
        if (nextIndex === -1) {
            /* All timers done */
            completeSequence();
            return;
        }

        state.currentIndex = nextIndex;
        const nextTimer = state.timers[state.currentIndex];
        state.totalForCurrent = timerToSeconds(nextTimer);
        state.remaining = state.totalForCurrent;
    }

    updateDisplay();
}

function findNextTimer(startFrom) {
    for (let i = startFrom; i < state.timers.length; i++) {
        if (timerToSeconds(state.timers[i]) > 0) {
            return i;
        }
    }
    return -1;
}

function completeSequence() {
    clearInterval(state.intervalId);
    state.intervalId = null;
    state.isRunning = false;
    state.isPaused = false;
    state.remaining = 0;
    state.currentIndex = 0;
    document.title = 'Sequence Timer — Complete!';
    render();

    /* Reset title after a moment */
    setTimeout(() => {
        document.title = 'Sequence Timer — Multi-Timer Sequencer';
    }, 3000);
}

function cancelAll() {
    clearInterval(state.intervalId);
    state.intervalId = null;
    state.isRunning = false;
    state.isPaused = false;
    state.remaining = 0;
    state.currentIndex = 0;
    document.title = 'Sequence Timer — Multi-Timer Sequencer';
    render();
}

function cancelAndReset() {
    clearInterval(state.intervalId);
    state.intervalId = null;
    state.isRunning = false;
    state.isPaused = false;
    state.remaining = 0;
    state.currentIndex = 0;
    state.timers = [createTimer()];
    document.title = 'Sequence Timer — Multi-Timer Sequencer';
    render();
}

/* ===== Rendering ===== */
function render() {
    renderDisplay();
    renderControls();
    renderTimerList();
    renderSequenceDots();
    renderSequences();
    updateHint();
}

function updateDisplay() {
    dom.timerDisplay.textContent = formatTime(state.remaining);

    /* Progress bar */
    const progress = state.totalForCurrent > 0
        ? ((state.totalForCurrent - state.remaining) / state.totalForCurrent) * 100
        : 0;
    dom.progressBar.style.width = `${progress}%`;

    /* Info */
    dom.timerInfo.textContent = `Timer ${state.currentIndex + 1} of ${state.timers.length}`;

    /* Tab title */
    document.title = `${formatTime(state.remaining)} — Sequence Timer`;

    /* Dots */
    renderSequenceDots();
}

function renderDisplay() {
    /* Display state classes */
    dom.display.classList.toggle('display--running', state.isRunning && !state.isPaused);
    dom.display.classList.toggle('display--paused', state.isPaused);

    if (state.isRunning) {
        dom.timerDisplay.textContent = formatTime(state.remaining);
        const progress = state.totalForCurrent > 0
            ? ((state.totalForCurrent - state.remaining) / state.totalForCurrent) * 100
            : 0;
        dom.progressBar.style.width = `${progress}%`;
        dom.timerInfo.textContent = state.isPaused
            ? `Paused — Timer ${state.currentIndex + 1} of ${state.timers.length}`
            : `Timer ${state.currentIndex + 1} of ${state.timers.length}`;
    } else {
        dom.timerDisplay.textContent = '00:00:00';
        dom.progressBar.style.width = '0%';
        dom.timerInfo.textContent = 'Ready';
    }
}

function renderControls() {
    if (state.isRunning && !state.isPaused) {
        dom.btnStart.innerHTML = '<span class="controls__btn-icon">⏸</span> Pause';
    } else if (state.isPaused) {
        dom.btnStart.innerHTML = '<span class="controls__btn-icon">▶</span> Resume';
    } else {
        dom.btnStart.innerHTML = '<span class="controls__btn-icon">▶</span> Start';
    }

    dom.btnCancel.disabled = !state.isRunning;
    dom.btnAddTimer.disabled = state.timers.length >= MAX_TIMERS || state.isRunning;
}

function renderTimerList() {
    dom.timerList.innerHTML = state.timers.map((timer, index) => {
        const isActive = state.isRunning && index === state.currentIndex;
        const isDone = state.isRunning && index < state.currentIndex;
        const activeClass = isActive ? ' timer-item--active' : '';
        const doneClass = isDone ? ' timer-item--done' : '';
        const disabled = state.isRunning ? 'disabled' : '';
        const canRemove = state.timers.length > 1 && !state.isRunning;

        return `
            <div class="timer-item${activeClass}${doneClass}" data-id="${timer.id}">
                <span class="timer-item__label">${index + 1}</span>
                <div class="timer-item__time">
                    <input type="number" class="timer-item__input" data-field="hours"
                        min="0" max="99" value="${timer.hours}" ${disabled}
                        aria-label="Hours for timer ${index + 1}">
                    <span class="timer-item__separator">:</span>
                    <input type="number" class="timer-item__input" data-field="minutes"
                        min="0" max="59" value="${timer.minutes}" ${disabled}
                        aria-label="Minutes for timer ${index + 1}">
                    <span class="timer-item__separator">:</span>
                    <input type="number" class="timer-item__input" data-field="seconds"
                        min="0" max="59" value="${timer.seconds}" ${disabled}
                        aria-label="Seconds for timer ${index + 1}">
                </div>
                <button class="timer-item__remove" type="button"
                    ${canRemove ? '' : 'disabled'}
                    aria-label="Remove timer ${index + 1}">&times;</button>
            </div>`;
    }).join('');
}

function renderSequenceDots() {
    if (state.timers.length <= 1) {
        dom.sequenceDots.innerHTML = '';
        return;
    }

    dom.sequenceDots.innerHTML = state.timers.map((_, index) => {
        let dotClass = 'display__dot';
        if (state.isRunning && index === state.currentIndex) {
            dotClass += ' display__dot--active';
        } else if (state.isRunning && index < state.currentIndex) {
            dotClass += ' display__dot--done';
        }
        return `<span class="${dotClass}"></span>`;
    }).join('');
}

function renderSequences() {
    if (state.savedSequences.length === 0) {
        dom.sequenceList.innerHTML = '';
        dom.sequencesEmpty.style.display = '';
        return;
    }

    dom.sequencesEmpty.style.display = 'none';
    dom.sequenceList.innerHTML = state.savedSequences.map((seq, index) => {
        const timerCount = seq.timers.length;
        const totalSec = seq.timers.reduce((sum, t) => sum + (t.hours * 3600 + t.minutes * 60 + t.seconds), 0);
        return `
            <div class="sequence-item">
                <div class="sequence-item__info">
                    <div class="sequence-item__name">${escapeHtml(seq.name)}</div>
                    <div class="sequence-item__meta">${timerCount} timer${timerCount !== 1 ? 's' : ''} · ${formatTime(totalSec)} total</div>
                </div>
                <button class="sequence-item__btn sequence-item__btn--load" data-index="${index}" type="button">Load</button>
                <button class="sequence-item__btn sequence-item__btn--delete" data-index="${index}" type="button">Delete</button>
            </div>`;
    }).join('');
}

function updateHint() {
    const remaining = MAX_TIMERS - state.timers.length;
    if (state.isRunning) {
        dom.timerHint.textContent = 'Sequence is running...';
    } else if (remaining <= 0) {
        dom.timerHint.textContent = 'Maximum of 10 timers reached.';
    } else {
        dom.timerHint.textContent = `Add up to ${remaining} more timer${remaining !== 1 ? 's' : ''}. They will run one after another.`;
    }
}

function flashDisplay() {
    dom.display.classList.remove('display--flash');
    /* Force reflow to restart animation */
    void dom.display.offsetWidth;
    dom.display.classList.add('display--flash');
    setTimeout(() => dom.display.classList.remove('display--flash'), 600);
}

/* ===== Sequence Persistence ===== */
function loadSavedSequences() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            state.savedSequences = JSON.parse(data);
        }
    } catch {
        state.savedSequences = [];
    }
}

function persistSavedSequences() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedSequences));
}

function loadSequence(index) {
    if (state.isRunning) {
        cancelAll();
    }
    const seq = state.savedSequences[index];
    if (!seq) {
        return;
    }
    state.timers = seq.timers.map((t) => ({
        id: generateId(),
        hours: t.hours,
        minutes: t.minutes,
        seconds: t.seconds
    }));
    render();
}

function deleteSequence(index) {
    state.savedSequences.splice(index, 1);
    persistSavedSequences();
    renderSequences();
}

/* ===== Audio (Web Audio API Bell Chime) ===== */
function playBellSound() {
    let audioCtx;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
        return;
    }

    /* Bell chord: C5, E5, G5 */
    const frequencies = [523.25, 659.25, 783.99];
    const now = audioCtx.currentTime;

    frequencies.forEach((freq, i) => {
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

        oscillator.connect(gain);
        gain.connect(audioCtx.destination);

        oscillator.start(now + i * 0.04);
        oscillator.stop(now + 2);
    });

    /* Cleanup */
    setTimeout(() => audioCtx.close(), 2500);
}

/* ===== Utilities ===== */
function createTimer() {
    return {
        id: generateId(),
        hours: 0,
        minutes: 0,
        seconds: 0
    };
}

function generateId() {
    return `t_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function timerToSeconds(timer) {
    return timer.hours * 3600 + timer.minutes * 60 + timer.seconds;
}

function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
