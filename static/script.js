/**
 * Network Monitor - Frontend Logic
 * Auto-refreshes host status every 5 seconds.
 * Supports recording ping data to PostgreSQL and Chart.js graphs.
 */

const API_URL = '/api/status';
const REFRESH_URL = '/api/refresh';
const REFRESH_INTERVAL = 5000; // 5 seconds

let previousStatuses = {};
let refreshTimer = null;
let pingChart = null;
let currentGraphIp = null;
let graphRefreshTimer = null;

// ---- Initialize ----
document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    startAutoRefresh();

    document.getElementById('btnRefresh').addEventListener('click', manualRefresh);
    document.getElementById('btnAddHost').addEventListener('click', addHost);
    document.getElementById('btnCloseModal').addEventListener('click', closeGraphModal);
    document.getElementById('btnModalRefresh').addEventListener('click', () => {
        if (currentGraphIp) loadPingGraph(currentGraphIp);
    });
    document.getElementById('graphModal').addEventListener('click', (e) => {
        if (e.target.id === 'graphModal') closeGraphModal();
    });

    // Enter key on inputs
    document.getElementById('inputIp').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('inputLabel').focus();
    });
    document.getElementById('inputLabel').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addHost();
    });
});

// ---- Auto Refresh ----
function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchStatus, REFRESH_INTERVAL);
}

// ---- Fetch Status ----
async function fetchStatus() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Failed to fetch status:', error);
    }
}

// ---- Manual Refresh ----
async function manualRefresh() {
    const btn = document.getElementById('btnRefresh');
    btn.classList.add('spinning');
    btn.disabled = true;

    try {
        const response = await fetch(REFRESH_URL, { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Manual refresh failed:', error);
        await fetchStatus();
    } finally {
        setTimeout(() => {
            btn.classList.remove('spinning');
            btn.disabled = false;
        }, 600);
    }
}

// ---- Update Dashboard ----
function updateDashboard(data) {
    updateSummary(data.summary);
    updateHostGrid(data.hosts);
    updateLastCheckTime();
}

// ---- Update Summary ----
function updateSummary(summary) {
    animateValue('totalHosts', summary.total);
    animateValue('onlineHosts', summary.online);
    animateValue('offlineHosts', summary.offline);
    animateValue('recordingCount', summary.recording_count);

    const avgEl = document.getElementById('avgLatency');
    if (summary.avg_response_time !== null) {
        avgEl.textContent = `${summary.avg_response_time} ms`;
    } else {
        avgEl.textContent = '—';
    }
}

// ---- Animate Number Changes ----
function animateValue(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    if (current !== newValue) {
        el.textContent = newValue;
        el.style.transform = 'scale(1.15)';
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
        el.style.transition = 'transform 0.2s ease';
    }
}

// ---- Update Host Grid ----
function updateHostGrid(hosts) {
    const grid = document.getElementById('hostsGrid');

    const existingCards = grid.querySelectorAll('.host-card');
    if (existingCards.length !== hosts.length) {
        grid.innerHTML = '';
        hosts.forEach((host, index) => {
            const card = createHostCard(host, index);
            grid.appendChild(card);
        });
    } else {
        hosts.forEach((host, index) => {
            updateHostCard(host, index);
        });
    }

    hosts.forEach(host => {
        previousStatuses[host.ip] = host.is_online;
    });
}

// ---- Create Host Card ----
function createHostCard(host, index) {
    const card = document.createElement('div');
    card.className = `host-card ${host.is_online ? 'online' : 'offline'} ${host.is_recording ? 'recording' : ''}`;
    card.id = `host-${index}`;
    card.style.animationDelay = `${index * 50}ms`;
    card.style.animation = 'fadeInUp 0.4s ease forwards';

    card.innerHTML = `
        <div class="card-header">
            <div>
                <div class="host-label">${escapeHtml(host.label)}</div>
                <div class="host-ip">${escapeHtml(host.ip)}</div>
            </div>
            <div class="card-header-actions">
                <div class="status-badge ${host.is_online ? 'online' : 'offline'}">
                    <span class="status-dot"></span>
                    ${host.is_online ? 'Online' : 'Offline'}
                </div>
            </div>
        </div>
        <div class="card-metrics">
            <div class="metric">
                <span class="metric-label">Latency</span>
                <span class="metric-value latency-value">${host.response_time !== null ? host.response_time + ' ms' : '—'}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Packet Loss</span>
                <span class="metric-value">${host.packet_loss}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Checks</span>
                <span class="metric-value">${host.check_count}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Last Check</span>
                <span class="metric-value last-check-value">${host.last_check ? formatTime(host.last_check) : '—'}</span>
            </div>
        </div>
        <div class="uptime-bar-container">
            <div class="uptime-header">
                <span class="uptime-label">Uptime</span>
                <span class="uptime-percent">${host.uptime_percent}%</span>
            </div>
            <div class="uptime-bar">
                <div class="uptime-fill" style="width: ${host.uptime_percent}%"></div>
            </div>
        </div>
        <div class="card-actions">
            <button class="btn-record ${host.is_recording ? 'active' : ''}" onclick="toggleRecording('${escapeHtml(host.ip)}')" title="${host.is_recording ? 'Stop Recording' : 'Start Recording'}">
                <span class="record-dot"></span>
                <span class="record-text">${host.is_recording ? 'Recording...' : 'Record'}</span>
            </button>
            <button class="btn-graph" onclick="openGraphModal('${escapeHtml(host.ip)}', '${escapeHtml(host.label)}')" title="Lihat Grafik Ping">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                <span>Graph</span>
            </button>
            <button class="btn-delete" onclick="removeHost('${escapeHtml(host.ip)}')" title="Hapus Host">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `;

    return card;
}

// ---- Update Existing Host Card ----
function updateHostCard(host, index) {
    const card = document.getElementById(`host-${index}`);
    if (!card) return;

    const wasOnline = previousStatuses[host.ip];
    const statusChanged = wasOnline !== undefined && wasOnline !== host.is_online;

    card.className = `host-card ${host.is_online ? 'online' : 'offline'} ${host.is_recording ? 'recording' : ''}`;
    if (statusChanged) {
        card.classList.add('status-changed');
        setTimeout(() => card.classList.remove('status-changed'), 500);
    }

    const badge = card.querySelector('.status-badge');
    badge.className = `status-badge ${host.is_online ? 'online' : 'offline'}`;
    badge.innerHTML = `<span class="status-dot"></span> ${host.is_online ? 'Online' : 'Offline'}`;

    const metricValues = card.querySelectorAll('.metric-value');
    metricValues[0].textContent = host.response_time !== null ? host.response_time + ' ms' : '—';
    metricValues[1].textContent = host.packet_loss + '%';
    metricValues[2].textContent = host.check_count;
    metricValues[3].textContent = host.last_check ? formatTime(host.last_check) : '—';

    const uptimePercent = card.querySelector('.uptime-percent');
    uptimePercent.textContent = host.uptime_percent + '%';

    const uptimeFill = card.querySelector('.uptime-fill');
    uptimeFill.style.width = host.uptime_percent + '%';

    // Update record button
    const recordBtn = card.querySelector('.btn-record');
    if (recordBtn) {
        recordBtn.className = `btn-record ${host.is_recording ? 'active' : ''}`;
        recordBtn.querySelector('.record-text').textContent = host.is_recording ? 'Recording...' : 'Record';
        recordBtn.title = host.is_recording ? 'Stop Recording' : 'Start Recording';
    }
}

// ---- Add Host ----
async function addHost() {
    const ipInput = document.getElementById('inputIp');
    const labelInput = document.getElementById('inputLabel');
    const ip = ipInput.value.trim();
    const label = labelInput.value.trim();

    if (!ip || !label) {
        shakeElement(ip ? labelInput : ipInput);
        return;
    }

    // Simple IP validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        shakeElement(ipInput);
        return;
    }

    const btn = document.getElementById('btnAddHost');
    btn.disabled = true;
    btn.classList.add('loading');

    try {
        const response = await fetch('/api/hosts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, label }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        ipInput.value = '';
        labelInput.value = '';
        await fetchStatus();
        showToast(`Host ${ip} (${label}) ditambahkan!`, 'success');
    } catch (error) {
        console.error('Failed to add host:', error);
        showToast('Gagal menambahkan host', 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
    }
}

// ---- Remove Host ----
async function removeHost(ip) {
    if (!confirm(`Hapus host ${ip}? Data ping juga akan dihapus.`)) return;

    try {
        const response = await fetch(`/api/hosts/${ip}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await fetchStatus();
        showToast(`Host ${ip} dihapus`, 'success');
    } catch (error) {
        console.error('Failed to remove host:', error);
        showToast('Gagal menghapus host', 'error');
    }
}

// ---- Toggle Recording ----
async function toggleRecording(ip) {
    try {
        // Check current recording state from the status data
        const statusResponse = await fetch(`/api/status/${ip}`);
        if (!statusResponse.ok) throw new Error(`HTTP ${statusResponse.status}`);
        const status = await statusResponse.json();

        const action = status.is_recording ? 'stop' : 'start';
        const response = await fetch(`/api/recording/${ip}/${action}`, { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        await fetchStatus();
        showToast(
            action === 'start' ? `Recording dimulai untuk ${ip}` : `Recording dihentikan untuk ${ip}`,
            'success'
        );
    } catch (error) {
        console.error('Failed to toggle recording:', error);
        showToast('Gagal mengubah status recording', 'error');
    }
}

// ---- Graph Modal ----
function openGraphModal(ip, label) {
    currentGraphIp = ip;
    document.getElementById('modalHostLabel').textContent = label;
    document.getElementById('modalHostIp').textContent = ip;
    document.getElementById('graphModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadPingGraph(ip);

    // Auto-refresh graph every 5s
    graphRefreshTimer = setInterval(() => loadPingGraph(ip), 5000);
}

function closeGraphModal() {
    document.getElementById('graphModal').classList.remove('active');
    document.body.style.overflow = '';
    currentGraphIp = null;
    if (graphRefreshTimer) {
        clearInterval(graphRefreshTimer);
        graphRefreshTimer = null;
    }
    if (pingChart) {
        pingChart.destroy();
        pingChart = null;
    }
}

async function loadPingGraph(ip) {
    const infoEl = document.getElementById('modalInfo');
    infoEl.textContent = 'Memuat data...';

    try {
        const response = await fetch(`/api/hosts/${ip}/history?limit=60`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data.history.length === 0) {
            infoEl.textContent = 'Belum ada data ping. Mulai recording terlebih dahulu.';
            if (pingChart) {
                pingChart.destroy();
                pingChart = null;
            }
            return;
        }

        renderPingChart(data.history);
        infoEl.textContent = `${data.history.length} data points — terakhir: ${data.history[data.history.length - 1].recorded_at}`;
    } catch (error) {
        console.error('Failed to load ping graph:', error);
        infoEl.textContent = 'Gagal memuat data grafik';
    }
}

function renderPingChart(history) {
    const ctx = document.getElementById('pingChart').getContext('2d');

    const labels = history.map(h => {
        const parts = h.recorded_at.split(' ');
        return parts.length >= 2 ? parts[1] : h.recorded_at;
    });

    const responseTimes = history.map(h => h.response_time);
    const onlineStatus = history.map(h => h.is_online);

    // Color points: green for online, red for offline
    const pointColors = onlineStatus.map(online =>
        online ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)'
    );

    if (pingChart) {
        // Update existing chart
        pingChart.data.labels = labels;
        pingChart.data.datasets[0].data = responseTimes;
        pingChart.data.datasets[0].pointBackgroundColor = pointColors;
        pingChart.update('none');
        return;
    }

    pingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Response Time (ms)',
                data: responseTimes,
                borderColor: 'rgba(56, 189, 248, 0.8)',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                pointBackgroundColor: pointColors,
                pointBorderColor: 'transparent',
                pointRadius: 4,
                pointHoverRadius: 6,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                spanGaps: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(148, 163, 184, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const idx = context.dataIndex;
                            const online = onlineStatus[idx];
                            const rt = context.parsed.y;
                            if (!online) return 'Status: Offline (timeout)';
                            return `Latency: ${rt} ms`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(148, 163, 184, 0.06)',
                    },
                    ticks: {
                        color: 'rgba(148, 163, 184, 0.6)',
                        font: { size: 10, family: 'Inter' },
                        maxTicksLimit: 10,
                        maxRotation: 45,
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'ms',
                        color: 'rgba(148, 163, 184, 0.6)',
                        font: { size: 11, family: 'Inter' },
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.06)',
                    },
                    ticks: {
                        color: 'rgba(148, 163, 184, 0.6)',
                        font: { size: 10, family: 'Inter' },
                    }
                }
            },
            animation: {
                duration: 0,
            }
        }
    });
}

// ---- Toast Notification ----
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---- Shake Element (input validation) ----
function shakeElement(el) {
    el.classList.add('shake');
    el.focus();
    setTimeout(() => el.classList.remove('shake'), 500);
}

// ---- Update Last Check Time ----
function updateLastCheckTime() {
    const el = document.getElementById('lastUpdate');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    el.innerHTML = `<span class="update-dot"></span> Terakhir update: ${timeStr}`;
}

// ---- Format Time ----
function formatTime(dateStr) {
    if (!dateStr) return '—';
    try {
        const parts = dateStr.split(' ');
        if (parts.length >= 2) {
            return parts[1];
        }
        return dateStr;
    } catch {
        return dateStr;
    }
}

// ---- Escape HTML ----
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- CSS Animation (injected) ----
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(16px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`;
document.head.appendChild(style);
