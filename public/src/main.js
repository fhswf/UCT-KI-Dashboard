let lastRateLimitToast = 0;

const envTimeout = parseInt(window.env?.API_TIMEOUT_MS, 10);
const API_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30000;

window.fetchWithTimeout = async function(url, timeout = API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
            showRateLimitToast(retryAfter);
            const err = new Error('Rate limited');
            err.rateLimited = true;
            throw err;
        }

        if (!response.ok) throw new Error(`API Fehler: ${response.status} ${response.statusText}`);
        return await response.json();
    } catch (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError') throw new Error('Timeout beim Laden der Daten');
        throw error;
    }
};

const loader = document.getElementById('chart-loader');
const tutorial = document.getElementById('chart-tutorial');

function showLoader() { loader.classList.remove('hidden'); }
function hideLoader() { loader.classList.add('hidden'); }
function hideTutorial() { tutorial.classList.add('hidden'); }

function formatLocalDate(dt) {
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateStringToEnd(dateStr) {
    const [year, month, date] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date + 1, 0, 0, 0, 0)).toISOString();
}

async function fetchChartData(sensorId, endParam = null) {
    const suffix = endParam ? `?end=${endParam}` : '';

    const [measurementsRes, dwdRes, neighborsRes] = await Promise.allSettled([
        window.fetchWithTimeout(`/api/sensor/${sensorId}/measurements${suffix}`),
        window.fetchWithTimeout(`/api/sensor/dwd${suffix}`),
        window.fetchWithTimeout(`/api/sensor/${sensorId}/neighbors`)
    ]);

    const sensorData = measurementsRes.status === 'fulfilled' ? measurementsRes.value : [];
    const dwdData    = dwdRes.status === 'fulfilled'          ? dwdRes.value         : [];
    const neighbors  = neighborsRes.status === 'fulfilled'    ? neighborsRes.value   : [];

    let neighborData = [];
    if (neighbors.length > 0) {
        try {
            neighborData = await window.fetchWithTimeout(
                `/api/sensor/${neighbors[0].id}/measurements${suffix}`
            );
        } catch (e) {
            console.warn('Fehler beim Laden der Nachbar-Daten:', e);
        }
    }

    return { sensorData, dwdData, neighborData };
}

async function updateChartData(sensorId) {
    showLoader();
    try {
        let endParam = null;
        if (window.selectedDate) {
            endParam = encodeURIComponent(dateStringToEnd(window.selectedDate));
        }

        const { sensorData, dwdData, neighborData } = await fetchChartData(sensorId, endParam);
        updateChart(sensorData, neighborData, dwdData, { resetView: true });
        return true;
    } catch (error) {
        console.error('Fehler beim Laden:', error);
        if (!error.rateLimited) {
            showToast(`Fehler beim Laden der Daten: ${error.message}`);
        }
        return false;
    } finally {
        hideLoader();
    }
}

function setSelectedDate(dateStr) {
    window.selectedDate = dateStr || null;
    const input = document.getElementById('datePicker');
    const todayStr = formatLocalDate(new Date());

    if (input) input.value = dateStr || todayStr;
    const url = new URL(window.location);

    if (dateStr) url.searchParams.set('date', dateStr);
    else url.searchParams.delete('date');

    window.history.replaceState({}, '', url);
    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) todayBtn.style.display = dateStr && dateStr !== todayStr ? 'block' : 'none';
}

// Refresh logik
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    const refreshIcon = refreshBtn.querySelector('.material-symbols-outlined');
    const refreshCooldown = 30000;
    let lastRefresh = 0;

    setInterval(async () => {
        if (window.selectedSensorId && document.visibilityState === 'visible') {
            refreshIcon.classList.add('rotating');
            await refreshData();
            refreshIcon.classList.remove('rotating');
        }
    }, (10 * 60 * 1000));

    async function refreshData() {
        sessionStorage.removeItem('sensorsData');
        const data = await loadSensors();
        let success = true;

        if (window.selectedSensorId) {
            try {
                const chartOk = await updateChartData(window.selectedSensorId);
                if (!chartOk) success = false;
            } catch (e) {
                console.warn('Fehler beim Aktualisieren des Diagramms nach Reload', e);
                success = false;
            }
        }

        if (!data) success = false;
        if (!success) console.warn('Auto-Refresh fehlgeschlagen');
        return data;
    }

    refreshBtn.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastRefresh < refreshCooldown) return;
        lastRefresh = now;

        refreshBtn.classList.add('cooldown');
        refreshIcon.classList.add('rotating');
        refreshData().then(() => refreshIcon.classList.remove('rotating'));
        setTimeout(() => refreshBtn.classList.remove('cooldown'), refreshCooldown);
    });
}

// Load
window.addEventListener('DOMContentLoaded', async () => {
    initMap();
    loadSensors();

    const params = new URLSearchParams(window.location.search);
    const sensorId = params.get('sensor');
    const dateParam = params.get('date');

    const dateInput = document.getElementById('datePicker');
    const todayBtn  = document.getElementById('todayBtn');

    if (dateInput) {
        dateInput.value = dateParam || formatLocalDate(new Date());
        dateInput.addEventListener('change', () => {
            setSelectedDate(dateInput.value);
            if (window.selectedSensorId) updateChartData(window.selectedSensorId);
        });
    }

    if (todayBtn) {
        todayBtn.style.display = 'none';
        todayBtn.addEventListener('click', () => {
            setSelectedDate(null);
            if (window.selectedSensorId) updateChartData(window.selectedSensorId);
        });
    }

    if (dateParam) setSelectedDate(dateParam);

    if (!sessionStorage.getItem('sensorsData')) {
        try { await checkCacheLoaded(); } catch (e) { console.warn(e.message); }
    }

    if (sensorId && sensorId !== window.selectedSensorId) {
        const layer = window.sensorsLayer?.getLayers?.().find(
            l => l.feature?.properties?.id === sensorId
        );
        if (layer) {
            layer.fire('click');
            layer.openPopup();
        } else {
            const url = new URL(window.location);
            url.searchParams.delete('sensor');
            window.history.replaceState({}, '', url);
        }
    }
});

function updateURL(sensorId) {
    const url = new URL(window.location);
    if (sensorId) url.searchParams.set('sensor', sensorId);
    else url.searchParams.delete('sensor');
    window.history.pushState({}, '', url);
}

async function checkCacheLoaded(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
            clearInterval(interval);
            reject(new Error('Sensor-Daten konnten nicht geladen werden'));
        }, timeoutMs);

        const interval = setInterval(() => {
            if (sessionStorage.getItem('sensorsData')) {
                clearInterval(interval);
                clearTimeout(deadline);
                resolve();
            }
        }, 100);
    });
}

function showToast(message, duration = 10000) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

function showRateLimitToast(retryAfterSec) {
    const now = Date.now();
    if (now - lastRateLimitToast < 5000) return;
    lastRateLimitToast = now;

    const sec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.ceil(retryAfterSec) : null;
    const msg = sec
        ? `Zu viele Anfragen. Bitte in ${sec} Sekunden erneut versuchen.`
        : 'Zu viele Anfragen. Bitte einen Moment warten.';
    showToast(msg);
}
window.showRateLimitToast = showRateLimitToast;

// data modal
const dataSourcesBtn = document.getElementById('dataSourcesBtn');
if (dataSourcesBtn) {
    const modal = document.getElementById('dataSourcesModal');
    let closeBtn = null;
    if (modal) {
        closeBtn = modal.querySelector('.close') || modal.querySelector('#closeModal')
            || modal.querySelector('.btn.close') || modal.querySelector('.material-symbols-outlined.btn');
    }
    if (!closeBtn) closeBtn = document.getElementById('closeModal');

    dataSourcesBtn.addEventListener('click', () => {
        if (modal) modal.classList.remove('hidden');
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (modal) modal.classList.add('hidden');
        });
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }
}

// close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('dataSourcesModal');
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    }
});

// close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('dataSourcesModal');
    const btn = document.getElementById('dataSourcesBtn');
    if (!modal) return;
    if (modal.classList.contains('hidden')) return;

    if (modal.contains(e.target)) return;
    if (btn && (btn === e.target || btn.contains(e.target))) return;
    modal.classList.add('hidden');
});