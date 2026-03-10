#!/bin/bash
# ============================================
# Network Monitor - Deployment Script for Debian
# ============================================
# Jalankan dengan: sudo bash deploy.sh
# ============================================

set -e

APP_DIR="/opt/network-monitor"
APP_USER="netmonitor"
VENV_DIR="$APP_DIR/venv"
SERVICE_NAME="network-monitor"

echo "========================================"
echo "  Network Monitor - Deployment Script"
echo "========================================"
echo ""

# 1. Install system dependencies
echo "[1/6] Menginstall dependencies sistem..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip iputils-ping libpq-dev > /dev/null 2>&1
echo "  ✓ Dependencies sistem terinstall"

# 2. Create application user (if not exists)
echo "[2/6] Membuat user aplikasi..."
if ! id "$APP_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
    echo "  ✓ User '$APP_USER' dibuat"
else
    echo "  ✓ User '$APP_USER' sudah ada"
fi

# 3. Copy application files
echo "[3/6] Menyalin file aplikasi ke $APP_DIR..."
mkdir -p "$APP_DIR/static"
cp main.py "$APP_DIR/"
cp monitor.py "$APP_DIR/"
cp database.py "$APP_DIR/"
cp requirements.txt "$APP_DIR/"
cp static/index.html "$APP_DIR/static/"
cp static/style.css "$APP_DIR/static/"
cp static/script.js "$APP_DIR/static/"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
echo "  ✓ File aplikasi tersalin"

# 4. Create virtual environment & install dependencies
echo "[4/6] Membuat virtual environment & install Python packages..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt" -q
chown -R "$APP_USER":"$APP_USER" "$VENV_DIR"
echo "  ✓ Virtual environment siap"

# 5. Create systemd service
echo "[5/6] Membuat systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Network Monitor - FastAPI Application
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${APP_DIR}
ExecStart=${VENV_DIR}/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8899
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Environment
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ Systemd service dibuat"

# 6. Enable and start service
echo "[6/6] Mengaktifkan dan menjalankan service..."
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}
sleep 2

# Check status
if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo ""
    echo "========================================"
    echo "  ✅ Deployment berhasil!"
    echo "========================================"
    echo ""
    echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):8899"
    echo "  API:        http://$(hostname -I | awk '{print $1}'):8899/api/status"
    echo ""
    echo "  Kelola service:"
    echo "    sudo systemctl status ${SERVICE_NAME}"
    echo "    sudo systemctl restart ${SERVICE_NAME}"
    echo "    sudo systemctl stop ${SERVICE_NAME}"
    echo "    sudo journalctl -u ${SERVICE_NAME} -f"
    echo ""
else
    echo ""
    echo "  ❌ Service gagal start. Cek log:"
    echo "    sudo journalctl -u ${SERVICE_NAME} -n 50"
    echo ""
    exit 1
fi
