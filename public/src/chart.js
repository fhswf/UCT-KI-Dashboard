window.myChart = null;
window.oldestLoadedTime = null;
window.isBackfilling = false;
window.newestLoadedTime = null;

function initChart() {
    const ctx = document.getElementById('Chart').getContext('2d');

    window.myChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: CHART_DATASETS },
        options: CHART_OPTIONS
    });

    ctx.canvas.addEventListener('dblclick', () => window.myChart.resetZoom());
}

window.addEventListener('DOMContentLoaded', initChart);

function toPoint(entry, field) {
    const v = entry[field];
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function toDataset(entries, field) {
    return entries.map(e => ({
        x: new Date(e.messzeit_utc).getTime(),
        y: toPoint(e, field)
    }));
}

function updateChart(sensorData, neighborData = [], dwdData = [], { resetView = false} = {}) {
    const chart = window.myChart;
    if (!chart) return;

    chart.data.datasets[0].data = toDataset(sensorData,   'temperature_raw');
    chart.data.datasets[1].data = toDataset(neighborData, 'temperature_raw');
    chart.data.datasets[2].data = toDataset(sensorData,   'temperature_ki_s1');
    chart.data.datasets[3].data = toDataset(sensorData,   'temperature_ki_s2');
    chart.data.datasets[4].data = toDataset(dwdData,      'dwd_temperature');
    chart.data.datasets[5].data = toDataset(dwdData,      'dwd_smooth_temperature');

    window.oldestLoadedTime = sensorData.length > 0
        ? new Date(sensorData[0].messzeit_utc).getTime()
        : null;
    window.newestLoadedTime = sensorData.length > 0
        ? new Date(sensorData[sensorData.length - 1].messzeit_utc).getTime()
        : null;
    window.isBackfilling = false;

    // DL-Button ausblenden wenn kein Nachbar vorhanden
    const dlButton = document.querySelector('.bullet[data-index="1"]');
    if (dlButton) {
        const hasDL = neighborData.length > 0;
        dlButton.style.display = hasDL ? 'block' : 'none';
        chart.setDatasetVisibility(1, hasDL);
    }

    if (resetView) {
        chart.resetZoom();
    }
    chart.update();

    updateStats(sensorData);
    document.getElementById('empty-chart').classList.toggle('hidden', sensorData.length > 0);
}

// Ältere Daten laden
function onChartPan({ chart }) {
    if (window.isBackfilling || !window.selectedSensorId) return;

    const dataset = chart.data.datasets[0].data;
    if (!dataset?.length) return;

    const dataMin = dataset[0].x;
    const dataMax = dataset[dataset.length - 1].x;

    const visibleMin = chart.scales.x.min;
    const visibleMax = chart.scales.x.max;
    const range = dataMax - dataMin || 1;

    const leftCoverage = (visibleMin - dataMin) / range;
    const rightCoverage = (dataMax - visibleMax) / range;

    // detect empty space in chart
    if (visibleMin < dataMin + (24 * 3600 * 1000) && leftCoverage < 0.5) {
        loadDayForEdge('left', visibleMin);
    }
    if (visibleMax > dataMax - (24 * 3600 * 1000) && rightCoverage < 0.5) {
        loadDayForEdge('right', visibleMax);
    }

    // Backfill trigger
    if (leftCoverage < 0.01) triggerBackfill();
    if (rightCoverage < 0.01) triggerForwardFill();
}

async function fetchSensorTriple(id, endTime) {
    const [sensorRes, dwdRes, neighborRes] = await Promise.allSettled([
        window.fetchWithTimeout(`/api/sensor/${id}/measurements?end=${endTime}`),
        window.fetchWithTimeout(`/api/sensor/dwd?end=${endTime}`),
        window.fetchWithTimeout(`/api/sensor/${id}/neighbors`)
    ]);

    const rateLimitErr = [sensorRes, dwdRes, neighborRes].find(r => r.status === 'rejected' && r.reason?.rateLimited);
    if (rateLimitErr) {
        throw rateLimitErr.reason;
    }

    const sensorData = sensorRes.status === 'fulfilled' ? sensorRes.value : [];
    const dwdData    = dwdRes.status    === 'fulfilled' ? dwdRes.value    : [];
    let neighborData = [];

    if (neighborRes.status === 'fulfilled' && neighborRes.value.length > 0) {
        try {
            neighborData = await window.fetchWithTimeout(`/api/sensor/${neighborRes.value[0].id}/measurements?end=${endTime}`);
        } catch (e) {
            if (e.rateLimited) {
                console.warn('Nachbar-Daten konnten nicht geladen werden (Rate Limit)', e);
                throw e;
            }
        }
    }

    return { sensorData, dwdData, neighborData };
}

async function triggerBackfill() {
    if (window.isBackfilling || !window.selectedSensorId || !window.oldestLoadedTime) return;
    const id = window.selectedSensorId;
    window.isBackfilling = true;
    showBackfillIndicator(true);

    try {
        const endTime = encodeURIComponent(new Date(window.oldestLoadedTime).toISOString());
        const data = await fetchSensorTriple(id, endTime);
        if (!data || (!data.sensorData.length && !data.neighborData.length && !data.dwdData.length)) {
            window.oldestLoadedTime = null; return;
        }
        // sensor may have changed while loading - discard
        if (id !== window.selectedSensorId) return;
        prependToChart(data.sensorData, data.neighborData, data.dwdData);
    } catch (e) {
        console.warn('Backfill fehlgeschlagen:', e);
    } finally {
        window.isBackfilling = false;
        showBackfillIndicator(false);
    }
}

async function triggerForwardFill() {
    if (window.isBackfilling || !window.selectedSensorId || !window.newestLoadedTime) return;
    window.isBackfilling = true;
    showBackfillIndicator(true);

    const id = window.selectedSensorId;

    try {
        const endTime = encodeURIComponent(new Date(window.newestLoadedTime + 24 * 3600 * 1000).toISOString());

        const data = await fetchSensorTriple(id, endTime);
        if (!data || (!data.sensorData.length && !data.neighborData.length && !data.dwdData.length)) {
            window.newestLoadedTime = null; return;
        }
        if (id !== window.selectedSensorId) return;
        appendToChart(data.sensorData, data.neighborData, data.dwdData);
    } catch (e) {
        console.warn('Forward fill fehlgeschlagen:', e);
    } finally {
        window.isBackfilling = false;
        showBackfillIndicator(false);
    }
}

async function loadDayForEdge(direction, timestamp) {
    if (window.isBackfilling || !window.selectedSensorId) return;
    window.isBackfilling = true;
    showBackfillIndicator(true);

    const id = window.selectedSensorId;

    try {
        const dt = new Date(timestamp);
        const dayEnd = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 1);
        const end = encodeURIComponent(new Date(dayEnd).toISOString());

        const data = await fetchSensorTriple(id, end);
        if (!data || (!data.sensorData.length && !data.neighborData.length && !data.dwdData.length)) return;
        if (id !== window.selectedSensorId) return;

        if (direction === "left") prependToChart(data.sensorData, data.neighborData, data.dwdData);
        else appendToChart(data.sensorData, data.neighborData, data.dwdData);
    } catch (e) {
        console.warn('Tagesdaten laden fehlgeschlagen:', e);
    } finally {
        window.isBackfilling = false;
        showBackfillIndicator(false);
    }
}

// Ältere Daten vor die bestehenden Datasets stellen
function prependToChart(olderSensorData, olderNeighborData = [], olderDwdData = []) {
    const chart = window.myChart;
    if (!chart) return;

    const existingMin = chart.data.datasets[0].data[0]?.x ?? Infinity;
    const isOlder = e => new Date(e.messzeit_utc).getTime() < existingMin;

    const sensor   = olderSensorData.filter(isOlder);
    const neighbor = olderNeighborData.filter(isOlder);
    const dwd      = olderDwdData.filter(isOlder);

    if (!sensor.length && !neighbor.length && !dwd.length) {
        window.oldestLoadedTime = null;
        return;
    }

    function prepend(index, entries, field) {
        chart.data.datasets[index].data = [
            ...toDataset(entries, field),
            ...chart.data.datasets[index].data
        ];
    }

    prepend(0, sensor,   'temperature_raw');
    prepend(1, neighbor, 'temperature_raw');
    prepend(2, sensor,   'temperature_ki_s1');
    prepend(3, sensor,   'temperature_ki_s2');
    prepend(4, dwd,      'dwd_temperature');

    const earliest = sensor[0] ?? neighbor[0] ?? dwd[0];
    window.oldestLoadedTime = new Date(earliest.messzeit_utc).getTime();

    chart.update('none');
}

function appendToChart(newSensorData, newNeighborData = [], newDwdData = []) {
    const chart = window.myChart;
    if (!chart) return;

    const existingMax = chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1]?.x ?? -Infinity;
    const isNewer = e => new Date(e.messzeit_utc).getTime() > existingMax;

    const sensor   = newSensorData.filter(isNewer);
    const neighbor = newNeighborData.filter(isNewer);
    const dwd      = newDwdData.filter(isNewer);

    if (!sensor.length && !neighbor.length && !dwd.length) {
        window.newestLoadedTime = null;
        return;
    }

    function append(index, entries, field) {
        chart.data.datasets[index].data = [
            ...chart.data.datasets[index].data,
            ...toDataset(entries, field)
        ];
    }

    append(0, sensor,   'temperature_raw');
    append(1, neighbor, 'temperature_raw');
    append(2, sensor,   'temperature_ki_s1');
    append(3, sensor,   'temperature_ki_s2');
    append(4, dwd,      'dwd_temperature');

    const latest = sensor.at(-1) ?? neighbor.at(-1) ?? dwd.at(-1);
    window.newestLoadedTime = new Date(latest.messzeit_utc).getTime();

    chart.update('none');
}

function showBackfillIndicator(show) {
    document.getElementById('backfill-indicator').classList.toggle('hidden', !show);
}

function updateStats(data) {
    if (!data?.length) return;

    const values = data
        .map(d => Number(d.temperature_ki_s1))
        .filter(v => Number.isFinite(v));

    if (!values.length) return;

    document.getElementById('stat-curr').innerText = values.at(-1).toFixed(1) + ' °C';
    document.getElementById('stat-min').innerText  = values.reduce((a, b) => a < b ? a : b).toFixed(1) + ' °C';
    document.getElementById('stat-max').innerText  = values.reduce((a, b) => a > b ? a : b).toFixed(1) + ' °C';
}

function resetStats() {
    ['stat-curr', 'stat-min', 'stat-max'].forEach(id => {
        document.getElementById(id).innerText = '—';
    });
}

document.querySelectorAll('.bullet').forEach(button => {
    button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        const chart = window.myChart;
        if (!chart) return;

        const isVisible = chart.isDatasetVisible(index);
        chart.setDatasetVisibility(index, !isVisible);
        chart.update();
        button.classList.toggle('inactive', isVisible);
    });
});

document.getElementById('resetZoomBtn').addEventListener('click', () => {
    window.myChart.resetZoom();
});