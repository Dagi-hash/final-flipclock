/* ================= ENVIRONMENT ================= */
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

/* ================= PWA: SERVICE WORKER + INSTALL ================= */
if ('serviceWorker' in navigator && !isNativeApp) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const INSTALLED_KEY = 'flipclock.installed';

function isInstalledApp() {
    return standaloneQuery.matches || navigator.standalone === true;
}

/* Front-screen install button: visible until the app runs as an installed app (never in the APK) */
function updateInstallUI() {
    let installedFlag = false;
    try { installedFlag = localStorage.getItem(INSTALLED_KEY) === '1'; } catch (e) {}
    const show = !isInstalledApp() && !installedFlag && !isNativeApp;
    $('front-install-btn').hidden = !show;
}

function markInstalled() {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) {}
    deferredPrompt = null;
    updateInstallUI();
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    try { localStorage.removeItem(INSTALLED_KEY); } catch (err) {}
    updateInstallUI();
});
window.addEventListener('appinstalled', markInstalled);
standaloneQuery.addEventListener && standaloneQuery.addEventListener('change', updateInstallUI);

function showTip(title, sub) {
    showBanner(title, sub);
}

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            deferredPrompt = null;
            if (choice.outcome === 'accepted') markInstalled();
        });
    } else if (isIOS) {
        showTip('Install on iPhone', 'Tap Share, then "Add to Home Screen"');
    } else {
        showTip('Install App', 'Open the browser menu, then tap "Install app" or "Add to Home screen"');
    }
}

/* Keep the screen on while the app is open (it is a clock) */
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (e) {}
}

/* ================= PERSISTENCE ================= */
const STORE_KEY = 'flipclock.v1';
let theme = 'dark';
let clockMode = 'flip';

function saveState() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
            alarms, use24Hour, isMuted, theme, clockMode,
            timer: { total: timerTotalSeconds, remaining: timerRemainingSeconds, running: timerRunning, endAt: timerEndAt }
        }));
    } catch (e) {}
    scheduleNativeSync();
}
function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}

function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= THEME (dark / light) WITH CIRCULAR REVEAL ================= */
function setTheme(next) {
    theme = next;
    root.setAttribute('data-theme', next);
    const meta = $('meta-theme');
    if (meta) meta.setAttribute('content', next === 'light' ? '#D2B7C8' : '#000000');
}

let themeAnimating = false;
function toggleTheme() {
    if (themeAnimating) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    const btn = $('theme-toggle-btn');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endR = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 4;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const done = () => { themeAnimating = false; root.classList.remove('no-trans'); saveState(); };

    if (reduce) { setTheme(next); saveState(); return; }
    themeAnimating = true;
    root.classList.add('no-trans');

    if (document.startViewTransition) {
        let vt;
        try { vt = document.startViewTransition(() => setTheme(next)); } catch (e) { setTheme(next); done(); return; }
        vt.ready.then(() => {
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endR}px at ${x}px ${y}px)`] },
                { duration: 720, easing: 'cubic-bezier(.65,0,.2,1)', pseudoElement: '::view-transition-new(root)' }
            );
        }).catch(() => {});
        vt.finished.then(done, done);
        return;
    }

    /* Fallback: expanding circle that carries the new theme's background */
    const ov = document.createElement('div');
    ov.className = 'theme-reveal';
    ov.setAttribute('data-theme', next);
    ov.style.clipPath = `circle(0px at ${x}px ${y}px)`;
    document.body.appendChild(ov);
    const anim = ov.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endR}px at ${x}px ${y}px)`] },
        { duration: 720, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' }
    );
    anim.onfinish = () => { setTheme(next); requestAnimationFrame(() => { ov.remove(); done(); }); };
}

/* ================= 3D FOLDING FLIP CARD ENGINE ================= */
const flipValues = {};
const flipEls = {};

function initFlipUnits() {
    document.querySelectorAll('.flip-unit').forEach(unit => {
        const id = unit.getAttribute('data-flip-id');
        flipValues[id] = '0';
        unit.innerHTML = `
            <div class="upper-card"><span>0</span></div>
            <div class="lower-card"><span>0</span></div>
            <div class="flip-leaf">
                <div class="flip-leaf-front"><span>0</span></div>
                <div class="flip-leaf-back"><span>0</span></div>
            </div>
        `;
        flipEls[id] = {
            unit,
            upper: unit.querySelector('.upper-card span'),
            lower: unit.querySelector('.lower-card span'),
            front: unit.querySelector('.flip-leaf-front span'),
            back: unit.querySelector('.flip-leaf-back span'),
            timeout: null
        };
    });
}

function updateFlipUnit(id, newValue, animate = true) {
    const strVal = String(newValue);
    if (flipValues[id] === strVal) return;
    const el = flipEls[id];
    if (!el) return;

    const oldVal = flipValues[id] || '0';
    flipValues[id] = strVal;
    clearTimeout(el.timeout);

    if (!animate) {
        el.unit.classList.remove('flipping');
        el.upper.textContent = strVal;
        el.lower.textContent = strVal;
        el.front.textContent = strVal;
        el.back.textContent = strVal;
        return;
    }

    el.front.textContent = oldVal;
    el.back.textContent = strVal;
    el.upper.textContent = strVal;
    el.lower.textContent = oldVal;

    el.unit.classList.remove('flipping');
    void el.unit.offsetWidth;
    el.unit.classList.add('flipping');

    el.timeout = setTimeout(() => {
        el.lower.textContent = strVal;
        el.front.textContent = strVal;
        el.unit.classList.remove('flipping');
    }, 410);
}

const textCache = {};
function setText(id, value) {
    if (textCache[id] === value) return;
    textCache[id] = value;
    const el = $(id);
    if (el) el.textContent = value;
}

/* ================= NOTIFICATION BANNER (swipe left / right to dismiss) ================= */
let alertInterval = null;
let bannerBusy = false;

function showBanner(title, subtitle) {
    const banner = $('alert-banner');
    $('alert-title').textContent = title;
    $('alert-subtitle').textContent = subtitle;
    banner.classList.remove('leaving', 'dragging');
    banner.style.removeProperty('--tx');
    banner.style.removeProperty('--o');
    banner.classList.add('show');
    bannerBusy = false;
}

function hideBanner(direction) {
    const banner = $('alert-banner');
    if (!banner.classList.contains('show') || bannerBusy) return;
    bannerBusy = true;
    if (direction) {
        banner.classList.remove('dragging');
        banner.classList.add('leaving');
        banner.style.setProperty('--tx', (direction * (window.innerWidth + 80)) + 'px');
        banner.style.setProperty('--o', '0');
        setTimeout(() => {
            banner.classList.remove('show', 'leaving');
            banner.style.removeProperty('--tx');
            banner.style.removeProperty('--o');
            bannerBusy = false;
        }, 260);
    } else {
        banner.classList.remove('show');
        banner.style.removeProperty('--tx');
        banner.style.removeProperty('--o');
        bannerBusy = false;
    }
}

(function setupBannerSwipe() {
    const banner = $('alert-banner');
    let startX = 0, startY = 0, dx = 0, startT = 0, dragging = false, decided = false, pid = null;

    banner.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || !banner.classList.contains('show') || bannerBusy) return;
        dragging = true; decided = false; dx = 0;
        startX = e.clientX; startY = e.clientY; startT = performance.now(); pid = e.pointerId;
    });
    banner.addEventListener('pointermove', (e) => {
        if (!dragging || e.pointerId !== pid) return;
        const mx = e.clientX - startX, my = e.clientY - startY;
        if (!decided) {
            if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
            if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; }
            decided = true;
            banner.classList.add('dragging');
            try { banner.setPointerCapture(pid); } catch (err) {}
        }
        dx = mx;
        banner.style.setProperty('--tx', dx + 'px');
        banner.style.setProperty('--o', String(Math.max(0.15, 1 - Math.abs(dx) / (banner.offsetWidth * 0.9))));
    });
    const end = () => {
        if (!dragging) return;
        dragging = false;
        if (!decided) return;
        banner.classList.remove('dragging');
        const dt = Math.max(1, performance.now() - startT);
        const velocity = Math.abs(dx) / dt;
        if (Math.abs(dx) > banner.offsetWidth * 0.3 || (Math.abs(dx) > 40 && velocity > 0.5)) {
            dismissAlert(dx < 0 ? -1 : 1);
        } else {
            banner.style.setProperty('--tx', '0px');
            banner.style.setProperty('--o', '1');
            setTimeout(() => { banner.style.removeProperty('--tx'); banner.style.removeProperty('--o'); }, 400);
        }
    };
    banner.addEventListener('pointerup', end);
    banner.addEventListener('pointercancel', end);
})();

/* ================= WEB AUDIO SYNTHESIZER (used in browsers / if native alerts are unavailable) ================= */
let audioCtx = null;
let isMuted = false;

function ensureAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playBeepPattern() {
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) {}
    if (isMuted) return;
    try {
        ensureAudioContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        [880, 1174.66].forEach((f, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now + idx * 0.14);
            gain.gain.setValueAtTime(0.001, now + idx * 0.14);
            gain.gain.exponentialRampToValueAtTime(0.22, now + idx * 0.14 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + idx * 0.14);
            osc.stop(now + idx * 0.14 + 0.26);
        });
    } catch (e) {}
}

function triggerAlert(title, subtitle) {
    showBanner(title, subtitle);
    if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }
    /* On Android the system notification rings (even when the app is closed), so only synthesize sound when it is not available */
    if (!nativeOK) {
        playBeepPattern();
        alertInterval = setInterval(playBeepPattern, 1200);
    }
}

function dismissAlert(direction) {
    hideBanner(direction);
    if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }
    if (LN && nativeReady) {
        try { LN.removeAllDeliveredNotifications().catch(() => {}); } catch (e) {}
    }
}

function toggleMute() {
    ensureAudioContext();
    isMuted = !isMuted;
    $('sound-on-icon').hidden = isMuted;
    $('sound-off-icon').hidden = !isMuted;
    $('sound-label').textContent = isMuted ? 'Muted' : 'Sound On';
    saveState();
}

/* ================= NAVIGATION CONTROLLER ================= */
const tabOrder = ['clock', 'alarm', 'timer', 'stopwatch'];
const tabTitles = {
    clock: 'Current Time',
    alarm: 'Alarms',
    timer: 'Countdown',
    stopwatch: 'Stopwatch'
};
let currentTab = 'clock';

function switchTab(tabName) {
    if (tabName === currentTab) return;
    ensureAudioContext();
    const dir = tabOrder.indexOf(tabName) >= tabOrder.indexOf(currentTab) ? 1 : -1;
    currentTab = tabName;
    $('header-title').textContent = tabTitles[tabName] || 'Clock';
    root.style.setProperty('--dir', dir);

    tabOrder.forEach(t => {
        const section = $(`view-${t}`);
        section.classList.toggle('active', t === tabName);
    });

    $('nav-bar').style.setProperty('--i', tabOrder.indexOf(tabName));
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
}

/* ================= CLOCK STYLE (flip / digital / analog) ================= */
const clockModes = ['flip', 'digital', 'analog'];

function setClockMode(mode, persist = true) {
    if (clockModes.indexOf(mode) < 0) mode = 'flip';
    clockMode = mode;
    root.setAttribute('data-mode', mode);
    $('mode-seg').style.setProperty('--i', clockModes.indexOf(mode));
    document.querySelectorAll('#mode-seg button').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === mode));
    updateLiveClock(true);
    renderTimerDisplay(false);
    if (persist) saveState();
}

function buildAnalogDial() {
    let ticks = '';
    for (let i = 0; i < 60; i++) {
        const hr = i % 5 === 0;
        const r1 = hr ? 84 : 88, r2 = 93;
        const a = i * 6 * Math.PI / 180;
        const x1 = (100 + r1 * Math.sin(a)).toFixed(2), y1 = (100 - r1 * Math.cos(a)).toFixed(2);
        const x2 = (100 + r2 * Math.sin(a)).toFixed(2), y2 = (100 - r2 * Math.cos(a)).toFixed(2);
        ticks += `<line class="an-tick${hr ? ' hr' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
    }
    $('an-ticks').innerHTML = ticks;
    let nums = '';
    for (let n = 1; n <= 12; n++) {
        const a = n * 30 * Math.PI / 180;
        nums += `<text class="an-num" x="${(100 + 68 * Math.sin(a)).toFixed(2)}" y="${(100 - 68 * Math.cos(a)).toFixed(2)}">${n}</text>`;
    }
    $('an-nums').innerHTML = nums;
}

/* ================= LIVE CLOCK & ALARM ENGINE ================= */
let use24Hour = true;
let lastTriggeredMinuteKey = '';
let alarms = [];
let modalHour = 7;
let modalMinute = 0;

function toggleTimeFormat() {
    use24Hour = !use24Hour;
    $('format-toggle-btn').textContent = use24Hour ? '24H' : '12H';
    updateLiveClock(true);
    renderAlarms();
}

function formatTwoDigits(num) {
    return String(num).padStart(2, '0');
}

let lastDateStr = '';
function updateLiveClock(noAnim) {
    const now = new Date();
    const rawHours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const period = rawHours >= 12 ? 'PM' : 'AM';

    let displayHours = rawHours;
    let badge;
    if (!use24Hour) {
        displayHours = rawHours % 12 || 12;
        badge = period;
    } else {
        badge = '24H';
    }

    const hStr = formatTwoDigits(displayHours);
    const mStr = formatTwoDigits(minutes);
    const sStr = formatTwoDigits(seconds);

    if (clockMode === 'flip') {
        const anim = !noAnim;
        updateFlipUnit('clock-h1', hStr[0], anim);
        updateFlipUnit('clock-h2', hStr[1], anim);
        updateFlipUnit('clock-m1', mStr[0], anim);
        updateFlipUnit('clock-m2', mStr[1], anim);
        updateFlipUnit('clock-s1', sStr[0], anim);
        updateFlipUnit('clock-s2', sStr[1], anim);
        setText('clock-ampm', use24Hour ? 'HRS' : period);
    } else if (clockMode === 'digital') {
        setText('dg-h', hStr);
        setText('dg-m', mStr);
        setText('dg-s', sStr);
        setText('dg-ampm', badge);
    } else {
        /* analog: always shows AM / PM */
        const hourAngle = (rawHours % 12) * 30 + minutes * 0.5;
        const minAngle = minutes * 6 + seconds * 0.1;
        $('an-hour').setAttribute('transform', `rotate(${hourAngle} 100 100)`);
        $('an-min').setAttribute('transform', `rotate(${minAngle} 100 100)`);
        $('an-sec').setAttribute('transform', `rotate(${seconds * 6} 100 100)`);
        setText('an-ampm', period);
    }

    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    if (dateStr !== lastDateStr) { lastDateStr = dateStr; $('clock-date').textContent = dateStr; }

    const currentKey = `${now.toDateString()} ${rawHours}:${minutes}`;
    if (lastTriggeredMinuteKey !== currentKey) {
        alarms.forEach(alarm => {
            if (alarm.enabled && alarm.hour === rawHours && alarm.minute === minutes) {
                lastTriggeredMinuteKey = currentKey;
                triggerAlert('Alarm', `${formatAlarmTimeDisplay(alarm.hour, alarm.minute)} — ${alarm.label}`);
            }
        });
    }
}

function formatAlarmTimeDisplay(h, m) {
    if (use24Hour) {
        return `${formatTwoDigits(h)}:${formatTwoDigits(m)}`;
    }
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${formatTwoDigits(h12)}:${formatTwoDigits(m)} ${period}`;
}

function updateNextAlarmSummary() {
    const active = alarms.filter(a => a.enabled);
    if (active.length === 0) {
        setText('next-alarm-text', 'No active alarms');
        return;
    }
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let closest = active[0];
    let minDiff = Infinity;
    active.forEach(a => {
        let diff = a.hour * 60 + a.minute - nowMinutes;
        if (diff <= 0) diff += 1440;
        if (diff < minDiff) { minDiff = diff; closest = a; }
    });
    const hrsLeft = Math.floor(minDiff / 60);
    const minsLeft = minDiff % 60;
    setText('next-alarm-text', `Next: ${formatAlarmTimeDisplay(closest.hour, closest.minute)} (${hrsLeft}h ${minsLeft}m)`);
}

function renderAlarms() {
    saveState();
    const container = $('alarm-list');
    updateNextAlarmSummary();

    if (alarms.length === 0) {
        container.innerHTML = `<div class="empty">No alarms configured</div>`;
        return;
    }

    container.innerHTML = alarms.map(alarm => `
        <div class="alarm-item ${alarm.enabled ? '' : 'off'}">
            <div style="min-width:0">
                <div class="alarm-time">${formatAlarmTimeDisplay(alarm.hour, alarm.minute)}</div>
                <div class="alarm-label">${esc(alarm.label)}</div>
            </div>
            <div class="alarm-ctrl">
                <button onclick="toggleAlarm(${alarm.id})" class="switch ${alarm.enabled ? 'on' : ''}" aria-label="Toggle Alarm"><div class="knob"></div></button>
                <button onclick="deleteAlarm(${alarm.id})" class="del-btn" title="Delete Alarm">
                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function toggleAlarm(id) {
    alarms = alarms.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a);
    renderAlarms();
}

function deleteAlarm(id) {
    alarms = alarms.filter(a => a.id !== id);
    renderAlarms();
}

function openAlarmModal() {
    const now = new Date();
    modalHour = (now.getHours() + 1) % 24;
    modalMinute = 0;
    $('modal-hour').textContent = formatTwoDigits(modalHour);
    $('modal-minute').textContent = formatTwoDigits(modalMinute);
    $('modal-label').value = '';
    $('alarm-modal').classList.add('open');
}

function closeAlarmModal() {
    $('alarm-modal').classList.remove('open');
    const input = $('modal-label');
    if (input) input.blur();
}

function stepModalTime(unit, delta) {
    if (unit === 'h') {
        modalHour = (modalHour + delta + 24) % 24;
        $('modal-hour').textContent = formatTwoDigits(modalHour);
    } else {
        modalMinute = (modalMinute + delta + 60) % 60;
        $('modal-minute').textContent = formatTwoDigits(modalMinute);
    }
}

function saveNewAlarm() {
    const labelInput = $('modal-label').value.trim();
    alarms.push({ id: Date.now(), hour: modalHour, minute: modalMinute, label: labelInput || 'Alarm', enabled: true });
    alarms.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    renderAlarms();
    closeAlarmModal();
}

/* ================= COUNTDOWN TIMER ENGINE (timestamp based, survives reloads) ================= */
let timerTotalSeconds = 300;
let timerRemainingSeconds = 300;
let timerRunning = false;
let timerInterval = null;
let timerEndAt = 0;
let timerFinishedAt = 0;

function setTimerUI(state) {
    const labels = { ready: ['Start', 'Ready'], running: ['Pause', 'Running'], paused: ['Resume', 'Paused'], done: ['Start', 'Completed'] };
    $('timer-toggle-btn').textContent = labels[state][0];
    $('timer-status-badge').textContent = labels[state][1];
    $('timer-setup-controls').classList.toggle('dim', state === 'running');
}

function renderTimerDisplay(animate = true) {
    const hStr = formatTwoDigits(Math.floor(timerRemainingSeconds / 3600));
    const mStr = formatTwoDigits(Math.floor((timerRemainingSeconds % 3600) / 60));
    const sStr = formatTwoDigits(timerRemainingSeconds % 60);
    const a = animate && clockMode === 'flip';
    updateFlipUnit('timer-h1', hStr[0], a);
    updateFlipUnit('timer-h2', hStr[1], a);
    updateFlipUnit('timer-m1', mStr[0], a);
    updateFlipUnit('timer-m2', mStr[1], a);
    updateFlipUnit('timer-s1', sStr[0], a);
    updateFlipUnit('timer-s2', sStr[1], a);
    setText('td-h', hStr);
    setText('td-m', mStr);
    setText('td-s', sStr);
}

function adjustTimer(unitMultiplier, step) {
    if (timerRunning) return;
    timerRemainingSeconds = Math.max(0, Math.min(359999, timerRemainingSeconds + unitMultiplier * step));
    timerTotalSeconds = timerRemainingSeconds;
    renderTimerDisplay(true);
    saveState();
}

function setTimerPreset(seconds) {
    if (timerRunning) return;
    timerRemainingSeconds = seconds;
    timerTotalSeconds = seconds;
    renderTimerDisplay(true);
    saveState();
}

function timerTick() {
    const left = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    if (left !== timerRemainingSeconds) {
        timerRemainingSeconds = left;
        renderTimerDisplay(true);
    }
    if (left <= 0) {
        clearInterval(timerInterval);
        timerRunning = false;
        timerEndAt = 0;
        timerFinishedAt = Date.now();
        setTimerUI('done');
        saveState();
        triggerAlert('Timer Complete', 'Your countdown has finished');
    }
}

function toggleTimer() {
    ensureAudioContext();
    if (timerRunning) {
        clearInterval(timerInterval);
        timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
        timerRunning = false;
        timerEndAt = 0;
        setTimerUI('paused');
        renderTimerDisplay(true);
    } else {
        if (timerRemainingSeconds <= 0) return;
        timerRunning = true;
        timerEndAt = Date.now() + timerRemainingSeconds * 1000;
        setTimerUI('running');
        timerInterval = setInterval(timerTick, 250);
    }
    saveState();
}

function resetTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerEndAt = 0;
    timerRemainingSeconds = timerTotalSeconds || 300;
    setTimerUI('ready');
    renderTimerDisplay(true);
    saveState();
}

/* ================= STOPWATCH & LAP COUNTER ENGINE ================= */
let swRunning = false;
let swStartTime = 0;
let swElapsedMs = 0;
let swRafId = null;
let swLaps = [];
let lastLapTotalMs = 0;

function renderStopwatchDisplay(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60) % 100;
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);

    const mStr = formatTwoDigits(minutes);
    const sStr = formatTwoDigits(seconds);
    const csStr = formatTwoDigits(centiseconds);

    if (clockMode === 'flip') {
        updateFlipUnit('sw-m1', mStr[0], true);
        updateFlipUnit('sw-m2', mStr[1], true);
        updateFlipUnit('sw-s1', sStr[0], true);
        updateFlipUnit('sw-s2', sStr[1], true);
        updateFlipUnit('sw-ms1', csStr[0], false);
        updateFlipUnit('sw-ms2', csStr[1], false);
    } else {
        setText('sd-m', mStr);
        setText('sd-s', sStr);
        setText('sd-c', csStr);
    }
}

function formatStopwatchString(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${formatTwoDigits(minutes)}:${formatTwoDigits(seconds)}.${formatTwoDigits(centiseconds)}`;
}

function currentStopwatchMs() {
    return swRunning ? swElapsedMs + (performance.now() - swStartTime) : swElapsedMs;
}

function tickStopwatch() {
    if (!swRunning) return;
    renderStopwatchDisplay(swElapsedMs + (performance.now() - swStartTime));
    swRafId = requestAnimationFrame(tickStopwatch);
}

function toggleStopwatch() {
    ensureAudioContext();
    const primaryBtn = $('sw-primary-btn');
    const secondaryBtn = $('sw-secondary-btn');

    if (swRunning) {
        swElapsedMs += performance.now() - swStartTime;
        swRunning = false;
        cancelAnimationFrame(swRafId);
        primaryBtn.textContent = 'Resume';
        secondaryBtn.textContent = 'Reset';
        secondaryBtn.disabled = false;
    } else {
        swStartTime = performance.now();
        swRunning = true;
        primaryBtn.textContent = 'Stop';
        secondaryBtn.textContent = 'Lap';
        secondaryBtn.disabled = false;
        swRafId = requestAnimationFrame(tickStopwatch);
    }
}

function lapOrResetStopwatch() {
    const primaryBtn = $('sw-primary-btn');
    const secondaryBtn = $('sw-secondary-btn');

    if (swRunning) {
        const totalMs = swElapsedMs + (performance.now() - swStartTime);
        const splitMs = totalMs - lastLapTotalMs;
        lastLapTotalMs = totalMs;
        swLaps.unshift({ number: swLaps.length + 1, split: splitMs, total: totalMs });
        renderLaps();
    } else {
        swElapsedMs = 0;
        lastLapTotalMs = 0;
        swLaps = [];
        primaryBtn.textContent = 'Start';
        secondaryBtn.textContent = 'Lap';
        secondaryBtn.disabled = true;
        renderStopwatchDisplay(0);
        renderLaps();
    }
}

function renderLaps() {
    const listEl = $('lap-list');
    if (swLaps.length === 0) {
        listEl.innerHTML = `<div class="lap-empty">No laps recorded</div>`;
        return;
    }

    let fastestSplit = Infinity;
    let slowestSplit = -Infinity;
    if (swLaps.length >= 2) {
        swLaps.forEach(l => {
            if (l.split < fastestSplit) fastestSplit = l.split;
            if (l.split > slowestSplit) slowestSplit = l.split;
        });
    }

    listEl.innerHTML = swLaps.map(lap => {
        let badge = '';
        if (swLaps.length >= 2) {
            if (lap.split === fastestSplit) badge = '<span class="tag best">BEST</span>';
            else if (lap.split === slowestSplit) badge = '<span class="tag slow">SLOW</span>';
        }
        return `
            <div class="lap-row">
                <span style="color:var(--muted);display:flex;align-items:center">#${formatTwoDigits(lap.number)}${badge}</span>
                <span style="font-weight:600">${formatStopwatchString(lap.split)}</span>
                <span style="color:var(--text-2)">${formatStopwatchString(lap.total)}</span>
            </div>
        `;
    }).join('');
}

/* ================= NATIVE ANDROID: ALARMS & TIMER THAT RING IN THE BACKGROUND ================= */
const LN = isNativeApp ? window.Capacitor.Plugins.LocalNotifications : null;
let nativeReady = false;   // channel created + permission granted
let nativeOK = false;      // true => the system notification provides the ring
let nativeSyncTimer = null;
let nativeSyncing = false;
let nativeSyncAgain = false;
let exactAsked = false;

function scheduleNativeSync() {
    if (!LN) return;
    clearTimeout(nativeSyncTimer);
    nativeSyncTimer = setTimeout(nativeSync, 300);
}

async function nativeSync() {
    if (nativeSyncing) { nativeSyncAgain = true; return; }
    nativeSyncing = true;
    try {
        if (!nativeReady) {
            let perm = await LN.checkPermissions();
            if (perm.display !== 'granted') perm = await LN.requestPermissions();
            if (perm.display !== 'granted') { nativeOK = false; return; }
            await LN.createChannel({
                id: 'flip_alarm', name: 'Alarms & Timer', description: 'Alarm and timer alerts that ring',
                importance: 5, visibility: 1, vibration: true, lights: true, sound: 'alarm_sound'
            });
            nativeReady = true;
            nativeOK = true;
        }
        if (!exactAsked) {
            exactAsked = true;
            try {
                const ex = await LN.checkExactNotificationSetting();
                if (ex && ex.exact_alarm && ex.exact_alarm !== 'granted') await LN.changeExactNotificationSetting();
            } catch (e) {}
        }

        const pending = await LN.getPending();
        const recentTimerFinish = Date.now() - timerFinishedAt < 5000;
        const toCancel = (pending.notifications || []).filter(n => !(n.id === 1 && recentTimerFinish));
        if (toCancel.length) await LN.cancel({ notifications: toCancel.map(n => ({ id: n.id })) });

        const list = [];
        alarms.filter(a => a.enabled).forEach(a => list.push({
            id: (a.id % 2000000000) + 10,
            title: a.label || 'Alarm',
            body: formatAlarmTimeDisplay(a.hour, a.minute),
            channelId: 'flip_alarm',
            smallIcon: 'ic_stat_alarm',
            ongoing: false,
            autoCancel: true,
            schedule: { on: { hour: a.hour, minute: a.minute }, allowWhileIdle: true }
        }));
        if (timerRunning && timerEndAt > Date.now() + 500) {
            list.push({
                id: 1, title: 'Timer Complete', body: 'Your countdown has finished',
                channelId: 'flip_alarm', smallIcon: 'ic_stat_alarm', ongoing: false, autoCancel: true,
                schedule: { at: new Date(timerEndAt), allowWhileIdle: true }
            });
        }
        if (list.length) await LN.schedule({ notifications: list });
    } catch (e) {
        console.error('native sync failed', e);
    } finally {
        nativeSyncing = false;
        if (nativeSyncAgain) { nativeSyncAgain = false; scheduleNativeSync(); }
    }
}

/* ================= INITIALIZATION ================= */
function init() {
    const s = loadState();
    if (Array.isArray(s.alarms)) alarms = s.alarms;
    use24Hour = s.use24Hour !== false;
    isMuted = !!s.isMuted;
    theme = s.theme === 'light' ? 'light' : 'dark';
    clockMode = clockModes.indexOf(s.clockMode) > -1 ? s.clockMode : 'flip';
    setTheme(theme);

    $('format-toggle-btn').textContent = use24Hour ? '24H' : '12H';
    $('sound-on-icon').hidden = isMuted;
    $('sound-off-icon').hidden = !isMuted;
    $('sound-label').textContent = isMuted ? 'Muted' : 'Sound On';

    initFlipUnits();
    buildAnalogDial();

    let finishedWhileAway = false;
    if (s.timer) {
        timerTotalSeconds = s.timer.total ?? 300;
        timerRemainingSeconds = s.timer.remaining ?? timerTotalSeconds;
        if (s.timer.running && s.timer.endAt) {
            timerEndAt = s.timer.endAt;
            timerRemainingSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
            if (timerRemainingSeconds > 0) {
                timerRunning = true;
                setTimerUI('running');
                timerInterval = setInterval(timerTick, 250);
            } else {
                timerEndAt = 0;
                setTimerUI('done');
                finishedWhileAway = true;
            }
        }
    }

    setClockMode(clockMode, false);
    renderAlarms();
    renderTimerDisplay(false);
    renderStopwatchDisplay(0);
    if (finishedWhileAway) triggerAlert('Timer Complete', 'Your countdown finished while the app was closed');

    // Tick aligned to the real second boundary so the clock never lags
    (function loop() {
        updateLiveClock();
        updateNextAlarmSummary();
        setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    })();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateLiveClock();
            if (timerRunning) timerTick();
            requestWakeLock();
        }
    });
    document.addEventListener('pointerdown', () => { ensureAudioContext(); requestWakeLock(); }, { passive: true });
    requestWakeLock();

    updateInstallUI();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
