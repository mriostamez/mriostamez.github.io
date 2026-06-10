/* ===== Constants ===== */
const MAX_TIMERS = 10;
const STORAGE_KEY = 'sequenceTimerSavedSequences';

/* ===== State & DOM (initialized on DOMContentLoaded) ===== */
let state;
let dom;
let globalAudioCtx = null;
let isHtml5AudioUnlocked = false;
let isPlayingRealSound = false;

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
        btnTestSound: document.getElementById('btnTestSound'),
        display: document.querySelector('.display')
    };

    loadSavedSequences();
    render();
    bindEvents();
    initAudioSystem();

    // One-time gesture listener to unlock Web Audio API on mobile (iOS/Android) browser autoplay policies
    const unlock = () => {
        unlockAudio();
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
});

/* ===== Event Binding ===== */
function bindEvents() {
    dom.btnStart.addEventListener('click', handleStartPause);
    dom.btnCancel.addEventListener('click', handleCancelAll);
    dom.btnReset.addEventListener('click', handleCancelAndReset);
    dom.btnAddTimer.addEventListener('click', handleAddTimer);
    dom.btnSaveSequence.addEventListener('click', handleSaveSequence);

    /* Delegate events on the timer list */
    dom.timerList.addEventListener('click', handleTimerListClick);

    /* Delegate events on the sequence list */
    dom.sequenceList.addEventListener('click', handleSequenceListClick);

    dom.btnTestSound.addEventListener('click', handleTestSound);

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

function bindScrollPickerEvents(picker, timerId, field) {
    const itemHeight = 34;
    let scrollTimeout;

    const handleScrollUpdate = () => {
        const items = picker.querySelectorAll('.scroll-picker__item');
        const value = Math.max(0, Math.min(items.length - 1, Math.round(picker.scrollTop / itemHeight)));
        const timer = state.timers.find((t) => t.id === timerId);
        if (timer && timer[field] !== value) {
            timer[field] = value;
        }

        // Highlight selected item in UI
        items.forEach((item, idx) => {
            if (idx === value) {
                item.classList.add('scroll-picker__item--selected');
            } else {
                item.classList.remove('scroll-picker__item--selected');
            }
        });
    };

    picker.addEventListener('scroll', () => {
        // Instant visual feedback for scrolling
        const items = picker.querySelectorAll('.scroll-picker__item');
        const tempValue = Math.max(0, Math.min(items.length - 1, Math.round(picker.scrollTop / itemHeight)));
        items.forEach((item, idx) => {
            if (idx === tempValue) {
                item.classList.add('scroll-picker__item--selected');
            } else {
                item.classList.remove('scroll-picker__item--selected');
            }
        });

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(handleScrollUpdate, 150);
    });

    picker.addEventListener('scrollend', () => {
        clearTimeout(scrollTimeout);
        handleScrollUpdate();
    });

    // Support smooth scroll to item on direct click
    picker.addEventListener('click', (event) => {
        if (state.isRunning) return;
        const item = event.target.closest('.scroll-picker__item');
        if (!item) return;
        const val = parseInt(item.dataset.value, 10);
        picker.scrollTo({
            top: val * itemHeight,
            behavior: 'smooth'
        });
    });
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
        const disabledClass = state.isRunning ? ' timer-item--disabled' : '';
        const canRemove = state.timers.length > 1 && !state.isRunning;

        return `
            <div class="timer-item${activeClass}${doneClass}${disabledClass}" data-id="${timer.id}">
                <span class="timer-item__label">${index + 1}</span>
                <div class="timer-item__time">
                    <div class="scroll-picker" data-field="hours" aria-label="Hours for timer ${index + 1}">
                        <div class="scroll-picker__list">
                            ${generatePickerOptions(0, 99, timer.hours)}
                        </div>
                    </div>
                    <span class="timer-item__separator">:</span>
                    <div class="scroll-picker" data-field="minutes" aria-label="Minutes for timer ${index + 1}">
                        <div class="scroll-picker__list">
                            ${generatePickerOptions(0, 59, timer.minutes)}
                        </div>
                    </div>
                    <span class="timer-item__separator">:</span>
                    <div class="scroll-picker" data-field="seconds" aria-label="Seconds for timer ${index + 1}">
                        <div class="scroll-picker__list">
                            ${generatePickerOptions(0, 59, timer.seconds)}
                        </div>
                    </div>
                    <div class="timer-item__time-overlay"></div>
                    <div class="timer-item__time-mask"></div>
                </div>
                <button class="timer-item__remove" type="button"
                    ${canRemove ? '' : 'disabled'}
                    aria-label="Remove timer ${index + 1}">&times;</button>
            </div>`;
    }).join('');

    // After inserting the HTML, set the scroll offsets of all pickers programmatically and bind events
    const timerItems = dom.timerList.querySelectorAll('.timer-item');
    timerItems.forEach((itemEl) => {
        const timerId = itemEl.dataset.id;
        const timer = state.timers.find((t) => t.id === timerId);
        if (!timer) return;

        const pickers = itemEl.querySelectorAll('.scroll-picker');
        pickers.forEach((picker) => {
            const field = picker.dataset.field;
            const value = timer[field];
            const itemHeight = 34; // Must match CSS line-height

            // Use requestAnimationFrame to ensure picker is fully laid out and scrollable
            requestAnimationFrame(() => {
                picker.scrollTop = value * itemHeight;
            });

            // Bind reactive scroll/click events
            bindScrollPickerEvents(picker, timerId, field);
        });
    });
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

/* ===== Audio (Web Audio API Bell Chime with Mobile Autoplay Unlock) ===== */
function initAudioSystem() {
    renderBellChime((buffer) => {
        if (!buffer) {
            console.warn('Could not pre-render bell chime offline. Fallback to live synthesis.');
            return;
        }

        // Normalize the buffer for maximum possible loudness without clipping
        normalizeBuffer(buffer);

        try {
            const wavBlob = bufferToWav(buffer);
            const wavUrl = URL.createObjectURL(wavBlob);
            dom.bellAudio = new Audio(wavUrl);
            dom.bellAudio.volume = 1.0;
        } catch (e) {
            console.error('Failed to create HTML5 Audio from pre-rendered buffer:', e);
        }
    });
}

function unlockAudio() {
    // 1. Unlock HTML5 Audio if initialized and not yet unlocked
    if (dom && dom.bellAudio && !isHtml5AudioUnlocked) {
        isHtml5AudioUnlocked = true;
        const playPromise = dom.bellAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                if (!isPlayingRealSound) {
                    dom.bellAudio.pause();
                    dom.bellAudio.currentTime = 0;
                }
            }).catch((err) => {
                isHtml5AudioUnlocked = false;
                console.log('HTML5 Audio unlock attempt status:', err.message);
            });
        }
    }

    // 2. Unlock/Initialize Web Audio AudioContext
    if (globalAudioCtx) {
        if (globalAudioCtx.state === 'suspended') {
            globalAudioCtx.resume().catch((e) => console.warn('Context resume failed:', e));
        }
        return;
    }

    try {
        globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Play an instantaneous silent buffer to warm up mobile hardware context
        const buffer = globalAudioCtx.createBuffer(1, 1, 22050);
        const source = globalAudioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(globalAudioCtx.destination);
        source.start(0);
    } catch (e) {
        console.warn('Audio Context initialization failed:', e);
    }
}

function playBellSound() {
    isPlayingRealSound = true;

    // Attempt HTML5 Audio first (much more stable inside background/timer threads on mobile)
    if (dom.bellAudio) {
        try {
            dom.bellAudio.pause();
            dom.bellAudio.currentTime = 0;
            const playPromise = dom.bellAudio.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    setTimeout(() => {
                        isPlayingRealSound = false;
                    }, 2500);
                }).catch((err) => {
                    isPlayingRealSound = false;
                    console.warn('HTML5 Audio play failed, falling back to Web Audio API:', err);
                    playBellLive();
                });
            }
            return;
        } catch (e) {
            isPlayingRealSound = false;
            console.warn('HTML5 Audio play error, falling back to Web Audio API:', e);
        }
    }

    playBellLive();
}

function playBellLive() {
    isPlayingRealSound = true;
    unlockAudio();
    if (!globalAudioCtx) {
        isPlayingRealSound = false;
        return;
    }

    const now = globalAudioCtx.currentTime;
    // C5 (523.25), E5 (659.25), G5 (783.99), and C6 (1046.5) for high clarity
    const frequencies = [523.25, 659.25, 783.99, 1046.5];
    const gains = [0.35, 0.25, 0.20, 0.15];

    frequencies.forEach((freq, i) => {
        const osc = globalAudioCtx.createOscillator();
        const gainNode = globalAudioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gainNode.gain.setValueAtTime(gains[i] * 0.8, now); // scale slightly to prevent clipping in sum
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);

        osc.connect(gainNode);
        gainNode.connect(globalAudioCtx.destination);

        osc.start(now);
        osc.stop(now + 2.5);
    });

    // Metallic transient strike
    const strikeOsc = globalAudioCtx.createOscillator();
    const strikeGain = globalAudioCtx.createGain();
    strikeOsc.type = 'triangle';
    strikeOsc.frequency.setValueAtTime(1500, now);
    strikeGain.gain.setValueAtTime(0.12, now);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    strikeOsc.connect(strikeGain);
    strikeGain.connect(globalAudioCtx.destination);
    strikeOsc.start(now);
    strikeOsc.stop(now + 0.1);

    setTimeout(() => {
        isPlayingRealSound = false;
    }, 2500);
}

function handleTestSound() {
    // Play sound directly, which naturally handles unlocking
    playBellSound();

    // Visual feedback for playing state
    const originalHTML = dom.btnTestSound.innerHTML;
    dom.btnTestSound.innerHTML = '<span class="controls__btn-icon">🔔</span> Playing...';
    dom.btnTestSound.disabled = true;
    setTimeout(() => {
        dom.btnTestSound.innerHTML = originalHTML;
        dom.btnTestSound.disabled = false;
    }, 1500);
}

function renderBellChime(callback) {
    const sampleRate = 44100;
    const duration = 2.5;
    let offlineCtx;
    try {
        offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, sampleRate * duration, sampleRate);
    } catch (e) {
        console.warn('OfflineAudioContext not supported:', e);
        callback(null);
        return;
    }

    const now = 0;
    const frequencies = [523.25, 659.25, 783.99, 1046.5];
    const gains = [0.35, 0.25, 0.20, 0.15];

    frequencies.forEach((freq, idx) => {
        const osc = offlineCtx.createOscillator();
        const gainNode = offlineCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gainNode.gain.setValueAtTime(gains[idx], now);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, duration);

        osc.connect(gainNode);
        gainNode.connect(offlineCtx.destination);
        osc.start(now);
        osc.stop(duration);
    });

    // Triangle strike transient
    const strikeOsc = offlineCtx.createOscillator();
    const strikeGain = offlineCtx.createGain();
    strikeOsc.type = 'triangle';
    strikeOsc.frequency.setValueAtTime(1500, now);
    strikeGain.gain.setValueAtTime(0.15, now);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, 0.08);

    strikeOsc.connect(strikeGain);
    strikeGain.connect(offlineCtx.destination);
    strikeOsc.start(now);
    strikeOsc.stop(0.1);

    offlineCtx.startRendering().then((renderedBuffer) => {
        callback(renderedBuffer);
    }).catch((err) => {
        console.error('Offline rendering failed:', err);
        callback(null);
    });
}

function normalizeBuffer(buffer) {
    const numOfChan = buffer.numberOfChannels;
    let maxVal = 0;

    // Find peak value
    for (let c = 0; c < numOfChan; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
            const absVal = Math.abs(data[i]);
            if (absVal > maxVal) {
                maxVal = absVal;
            }
        }
    }

    // Scale values to peak at 0.98 amplitude (loud and clean)
    if (maxVal > 0) {
        const scale = 0.98 / maxVal;
        for (let c = 0; c < numOfChan; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < data.length; i++) {
                data[i] *= scale;
            }
        }
    }
}

function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // RIFF WAV Header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // chunk size
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " subchunk
    setUint32(16); // subchunk size
    setUint16(1); // audio format (1 = PCM)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * numOfChan * 2); // byte rate
    setUint16(numOfChan * 2); // block align
    setUint16(16); // bits per sample

    setUint32(0x61746164); // "data" subchunk
    setUint32(length - pos - 4);

    for (i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    while (pos < length - 4) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([bufferArr], { type: 'audio/wav' });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
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

function generatePickerOptions(min, max, currentValue) {
    let html = '';
    for (let i = min; i <= max; i++) {
        const valStr = String(i).padStart(2, '0');
        const selectedClass = i === currentValue ? ' scroll-picker__item--selected' : '';
        html += `<div class="scroll-picker__item${selectedClass}" data-value="${i}">${valStr}</div>`;
    }
    return html;
}
