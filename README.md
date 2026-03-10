# Network Monitor 🌐

Website monitoring jaringan real-time menggunakan **FastAPI** dengan dashboard modern untuk memantau IP address.

## Fitur

- ✅ Monitoring 16 IP address secara bersamaan (async)
- ✅ Auto-refresh setiap 5 detik
- ✅ Dashboard dark theme modern (glassmorphism)
- ✅ Status online/offline dengan response time
- ✅ Statistik uptime percentage
- ✅ Manual refresh button
- ✅ Responsive design (desktop/tablet/mobile)
- ✅ Background monitoring setiap 10 detik

## Struktur Project

```
network-monitor/
├── main.py              # FastAPI application
├── monitor.py           # Network monitoring engine
├── requirements.txt     # Python dependencies
├── deploy.sh            # Deployment script untuk Debian
├── README.md
└── static/
    ├── index.html       # Dashboard UI
    ├── style.css        # Stylesheet
    └── script.js        # Frontend logic
```
## Instalasi postgreeSQL
 sudo apt-get install -y postgresql postgresql-contrib
 sudo systemctl start postgresql
 sudo systemctl enable postgresql

# Set password untuk user postgres
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"


## Instalasi Cepat (Debian Server)

### 1. Copy semua file ke server

```bash
scp -r network-monitor/ user@server:/tmp/
```

### 2. Jalankan deployment script

```bash
cd /tmp/network-monitor
sudo bash deploy.sh
```

Script akan otomatis:
- Install Python3 dan dependencies
- Membuat virtual environment
- Membuat systemd service
- Menjalankan aplikasi di port **8899**

### 3. Akses Dashboard

Buka browser: `http://IP-SERVER:8899`

## Instalasi Manual

```bash
# Install Python3
sudo apt update && sudo apt install -y python3 python3-venv python3-pip

# Buat virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Jalankan (perlu sudo untuk ICMP ping)
sudo venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8899
```

## API Endpoints

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/` | Dashboard UI |
| GET | `/api/status` | Status semua host |
| GET | `/api/status/{ip}` | Status satu host |
| POST | `/api/refresh` | Manual refresh semua host |

## Konfigurasi IP Address

Edit daftar IP di file `monitor.py`, pada variabel `DEFAULT_HOSTS`:

```python
DEFAULT_HOSTS = [
    {"ip": "192.168.1.1", "label": "Gateway"},
    {"ip": "8.8.8.8", "label": "Google DNS"},
    # ... tambah/ubah sesuai kebutuhan
]
```

## Kelola Service

```bash
sudo systemctl status network-monitor    # Cek status
sudo systemctl restart network-monitor   # Restart
sudo systemctl stop network-monitor      # Stop
sudo journalctl -u network-monitor -f    # Lihat log
```

## Requirements

- Python 3.8+
- Debian/Ubuntu (untuk deployment)
- Root/sudo access (diperlukan untuk ICMP ping)
