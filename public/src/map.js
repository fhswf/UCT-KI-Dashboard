let map;

window.selectedSensorId    = null;
window.selectedSensorLayer = null;

const SENSOR_STYLE = {
    default: {
        radius: 6, fillColor: '#0D2FA5', color: '#003080',
        weight: 1, opacity: 1, fillOpacity: 0.8
    },
    highlight: {
        radius: 10, fillColor: '#E40C2B', color: '#7a0615',
        weight: 2, opacity: 1, fillOpacity: 0.95
    }
};

function initMap() {
    map = L.map('map').setView([51.57, 8.10], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

function showMapLoader() {
    const el = document.getElementById('map-loader');
    el.innerHTML = `
        <div class="spinner"><span class="material-symbols-outlined">progress_activity</span></div>
        <span>Lade Sensoren...</span>`;
    el.classList.remove('hidden');
}

function hideMapLoader() {
    document.getElementById('map-loader').classList.add('hidden');
}

function showMapError() {
    const el = document.getElementById('map-loader');
    el.innerHTML = `
        <span class="material-symbols-outlined" style="font-size:36px;color:var(--accent)">wifi_off</span>
        <span>Keine Verbindung</span>`;
    el.classList.remove('hidden');
}

async function loadSensors() {
    const cached = sessionStorage.getItem('sensorsData');
    if (cached) {
        try { drawOnMap(JSON.parse(cached)); } 
        catch {}
    } else {
        showMapLoader();
    }

    try {
        const data = await window.fetchWithTimeout('/api/sensors');
        sessionStorage.setItem('sensorsData', JSON.stringify(data));
        drawOnMap(data);
        return data;
    } catch (e) {
        showMapError();
        console.error('Sensordaten konnten nicht geladen werden:', e);
        showToast(`Fehler beim Laden der Sensordaten: ${e.message}.\nPrüfe VPN/Netzwerk oder DB-Verbindung.`)
        return null;
    }
}

function drawOnMap(data) {
    hideMapLoader();
    if (window.sensorsLayer) map.removeLayer(window.sensorsLayer);

    window.sensorsLayer = L.geoJSON(data, {
        pointToLayer: (_, latlng) =>
            L.circleMarker(latlng, SENSOR_STYLE.default),

        onEachFeature: (feature, layer) => {
            if (!feature.properties?.id) return;

            // Popup bei Hover
            layer.bindPopup(`<b>${feature.properties.id}</b>`);
            layer.on('mouseover', () => layer.openPopup());
            layer.on('mouseout',  () => layer.closePopup());

            layer.on('click', () => {
                // Vorherigen Sensor zurücksetzen
                if (window.selectedSensorLayer && window.selectedSensorLayer !== layer) {
                    window.selectedSensorLayer.setStyle(SENSOR_STYLE.default);
                }

                layer.setStyle(SENSOR_STYLE.highlight);
                window.selectedSensorLayer = layer;
                window.selectedSensorId    = feature.properties.id;

                document.getElementById('sensor_name').textContent =
                    `${feature.properties.typ} ${feature.properties.id}`;

                resetStats();
                updateURL(feature.properties.id);
                updateChartData(feature.properties.id);
                hideTutorial();
            });
        }
    }).addTo(map);

    // Aktuell ausgewählten Sensor nach Karten-Reload hervorheben
    if (window.selectedSensorId) {
        window.sensorsLayer.eachLayer(layer => {
            if (layer.feature?.properties?.id === window.selectedSensorId) {
                layer.setStyle(SENSOR_STYLE.highlight);
                window.selectedSensorLayer = layer;
            }
        });
    }
}