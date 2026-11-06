Chart.defaults.elements.point.hitRadius = 10;

const CHART_DATASETS = [
    {
        label: 'Roh Temperatur',
        borderColor: '#E40C2B',
        borderWidth: 2,
        pointRadius: 3,
        order: 2,
    },
    {
        label: 'Decentlab Nachbar Temperatur',
        borderColor: '#0D2FA5',
        backgroundColor: '#0d2ea515',
        fill: true,
        borderWidth: 3,
        pointRadius: 0,
        order: 4,
    },
    {
        label: 'KI Temperatur Stage 1',
        borderColor: '#6e8941',
        borderWidth: 3, 
        pointRadius: 3,
        order: 1,
    },
    {
        label: 'KI Temperatur Stage 2',
        borderColor: '#4b5e2d',
        borderWidth: 3, 
        pointRadius: 3,
        order: 1,
    },
    {
        label: 'DWD Temperatur',
        borderColor: '#0a5e9c',
        borderDash: [10,5],
        borderWidth: 3,
        pointRadius: 0,
        order: 3,
    },
    {
        label: 'DWD Smooth Temperatur',
        borderColor: '#0ec7c7',
        borderWidth: 3,
        pointRadius: 0,
        LineTension: 0.4,
        order: 4,
    }
];

const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: false
        },
        zoom: {
            pan: {
                enabled: true,
                mode: 'x',
                onPan: (e) => onChartPan(e)
            },
            zoom: {
                wheel: {
                    enabled: true,
                },
                pinch: {
                    enabled: true
                },
                mode: 'x',
            }
        }
    },
    scales: {
        x: {
            type: 'time',
            time: {
                unit: 'hour',
                displayFormats: {
                    hour: 'dd.MM HH:mm'
                },
                tooltipFormat: 'dd.MM.yyyy HH:mm'
            },
            grid: {
                display: false
            }
        },
        y: {
            beginAtZero: false,
            ticks: {
                callback: function(value) {
                    return value + ' °C';
                }
            }
        }
    }
};