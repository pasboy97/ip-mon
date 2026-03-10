"""
Network Monitor - FastAPI Application
Run with: sudo python -m uvicorn main:app --host 0.0.0.0 --port 8899
(sudo required on Linux for ICMP ping)
"""

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from monitor import NetworkMonitor
from database import init_db, close_db, add_host as db_add_host, remove_host as db_remove_host
from database import get_all_hosts as db_get_all_hosts, get_ping_history


class HostInput(BaseModel):
    ip: str
    label: str


# Initialize the monitor (starts empty, hosts loaded from DB)
monitor = NetworkMonitor(interval=5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown events."""
    # Initialize database
    await init_db()

    # Load hosts from database
    db_hosts = await db_get_all_hosts()
    if db_hosts:
        for h in db_hosts:
            monitor.add_host(h["ip"], h["label"])
        print(f"[App] Loaded {len(db_hosts)} hosts from database")
    else:
        print("[App] No hosts in database. Add hosts via the web interface.")

    # Start monitoring in background
    task = asyncio.create_task(monitor.start_monitoring())
    yield
    # Stop monitoring on shutdown
    monitor.stop_monitoring()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await close_db()


app = FastAPI(
    title="Network Monitor",
    description="Real-time network monitoring dashboard with PostgreSQL",
    version="2.0.0",
    lifespan=lifespan,
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    """Serve the dashboard page."""
    return FileResponse("static/index.html")


# ---- Status APIs ----

@app.get("/api/status")
async def get_all_status():
    """Get status of all monitored hosts."""
    return {
        "hosts": monitor.get_all_status(),
        "summary": monitor.get_summary(),
    }


@app.get("/api/status/{ip}")
async def get_host_status(ip: str):
    """Get status of a single host."""
    status = monitor.get_host_status(ip)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Host {ip} not found")
    return status


@app.post("/api/refresh")
async def refresh_all():
    """Manually trigger a refresh of all hosts."""
    await monitor.check_all()
    return {
        "message": "Refresh complete",
        "hosts": monitor.get_all_status(),
        "summary": monitor.get_summary(),
    }


# ---- Host Management APIs ----

@app.post("/api/hosts")
async def add_host(host: HostInput):
    """Add a new host to monitor."""
    # Save to DB
    await db_add_host(host.ip, host.label)
    # Add to monitor
    monitor.add_host(host.ip, host.label)
    return {"message": f"Host {host.ip} ({host.label}) added", "ip": host.ip, "label": host.label}


@app.delete("/api/hosts/{ip}")
async def remove_host(ip: str):
    """Remove a host from monitoring."""
    status = monitor.get_host_status(ip)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Host {ip} not found")
    # Remove from monitor
    monitor.remove_host(ip)
    # Remove from DB (cascade deletes ping records)
    await db_remove_host(ip)
    return {"message": f"Host {ip} removed"}


# ---- Recording APIs ----

@app.post("/api/recording/{ip}/start")
async def start_recording(ip: str):
    """Start recording ping data for a host."""
    if not monitor.start_recording(ip):
        raise HTTPException(status_code=404, detail=f"Host {ip} not found")
    return {"message": f"Recording started for {ip}", "ip": ip, "is_recording": True}


@app.post("/api/recording/{ip}/stop")
async def stop_recording(ip: str):
    """Stop recording ping data for a host."""
    monitor.stop_recording(ip)
    return {"message": f"Recording stopped for {ip}", "ip": ip, "is_recording": False}


@app.get("/api/recording/status")
async def get_recording_status():
    """Get recording status for all hosts."""
    return monitor.get_recording_status()


# ---- History API ----

@app.get("/api/hosts/{ip}/history")
async def get_host_history(ip: str, limit: int = 60):
    """Get ping history for a host (for graph rendering)."""
    status = monitor.get_host_status(ip)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Host {ip} not found")
    history = await get_ping_history(ip, limit=limit)
    return {"ip": ip, "history": history}
