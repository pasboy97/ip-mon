"""
Network Monitor - Async ping monitoring for multiple IP addresses.
Requires root/admin privileges for ICMP ping on Linux.
"""

import asyncio
import time
import subprocess
import platform
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set
from datetime import datetime
from database import save_ping_record


@dataclass
class HostStatus:
    ip: str
    label: str
    is_online: bool = False
    response_time: Optional[float] = None  # in ms
    last_check: Optional[str] = None
    packet_loss: float = 100.0
    check_count: int = 0
    online_count: int = 0
    uptime_percent: float = 0.0


class NetworkMonitor:
    def __init__(self, hosts: Optional[List[dict]] = None, interval: int = 5):
        self.interval = interval
        self.hosts: Dict[str, HostStatus] = {}
        self._running = False
        self._recording: Set[str] = set()  # IPs currently recording

        # Start empty; hosts are loaded from the database at startup
        if hosts:
            for h in hosts:
                self.hosts[h["ip"]] = HostStatus(ip=h["ip"], label=h["label"])

    def add_host(self, ip: str, label: str):
        """Add a new host to monitor."""
        self.hosts[ip] = HostStatus(ip=ip, label=label)

    def remove_host(self, ip: str):
        """Remove a host from monitoring."""
        self.hosts.pop(ip, None)
        self._recording.discard(ip)

    def start_recording(self, ip: str) -> bool:
        """Start recording ping data for a host."""
        if ip not in self.hosts:
            return False
        self._recording.add(ip)
        return True

    def stop_recording(self, ip: str) -> bool:
        """Stop recording ping data for a host."""
        self._recording.discard(ip)
        return True

    def is_recording(self, ip: str) -> bool:
        """Check if a host is being recorded."""
        return ip in self._recording

    def get_recording_status(self) -> Dict[str, bool]:
        """Get recording status for all hosts."""
        return {ip: ip in self._recording for ip in self.hosts}

    async def ping_host(self, ip: str) -> tuple:
        """
        Ping a host using system ping command.
        Returns (is_online, response_time_ms).
        Works on both Windows and Linux (Debian).
        """
        system = platform.system().lower()

        if system == "windows":
            cmd = ["ping", "-n", "1", "-w", "2000", ip]
        else:
            # Linux / Debian
            cmd = ["ping", "-c", "1", "-W", "2", ip]

        try:
            start = time.perf_counter()
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            elapsed = (time.perf_counter() - start) * 1000  # ms

            output = stdout.decode("utf-8", errors="ignore")

            if proc.returncode == 0:
                # Try to extract actual ping time from output
                rt = self._parse_ping_time(output, system)
                return True, rt if rt is not None else round(elapsed, 2)
            else:
                return False, None

        except (asyncio.TimeoutError, Exception):
            return False, None

    def _parse_ping_time(self, output: str, system: str) -> Optional[float]:
        """Parse response time from ping output."""
        try:
            if system == "windows":
                # Windows: "Reply from x.x.x.x: bytes=32 time=1ms TTL=64"
                for line in output.splitlines():
                    if "time=" in line or "time<" in line:
                        part = line.split("time")[1]
                        num = ""
                        for ch in part:
                            if ch.isdigit() or ch == ".":
                                num += ch
                            elif num:
                                break
                        if num:
                            return round(float(num), 2)
            else:
                # Linux: "rtt min/avg/max/mdev = 1.234/1.234/1.234/0.000 ms"
                for line in output.splitlines():
                    if "rtt" in line or "round-trip" in line:
                        parts = line.split("=")[1].strip().split("/")
                        return round(float(parts[1]), 2)  # avg
                    # Alternative: "time=1.23 ms"
                    if "time=" in line:
                        part = line.split("time=")[1]
                        num = part.split(" ")[0].strip()
                        return round(float(num), 2)
        except (IndexError, ValueError):
            pass
        return None

    async def check_host(self, ip: str):
        """Check a single host and update its status."""
        is_online, response_time = await self.ping_host(ip)
        host = self.hosts[ip]
        host.is_online = is_online
        host.response_time = response_time
        host.last_check = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        host.check_count += 1
        if is_online:
            host.online_count += 1
        host.uptime_percent = round((host.online_count / host.check_count) * 100, 1)
        if is_online:
            host.packet_loss = 0.0
        else:
            host.packet_loss = 100.0

        # Save to DB if recording is active for this host
        if ip in self._recording:
            try:
                await save_ping_record(ip, response_time, is_online)
            except Exception as e:
                print(f"[Monitor] Failed to save ping record for {ip}: {e}")

    async def check_all(self):
        """Check all hosts concurrently."""
        tasks = [self.check_host(ip) for ip in self.hosts]
        await asyncio.gather(*tasks)

    async def start_monitoring(self):
        """Start the background monitoring loop."""
        self._running = True
        # Initial check immediately
        await self.check_all()
        while self._running:
            await asyncio.sleep(self.interval)
            await self.check_all()

    def stop_monitoring(self):
        """Stop the monitoring loop."""
        self._running = False

    def get_all_status(self) -> List[dict]:
        """Return status of all hosts as list of dicts."""
        results = []
        for ip, host in self.hosts.items():
            results.append({
                "ip": host.ip,
                "label": host.label,
                "is_online": host.is_online,
                "response_time": host.response_time,
                "last_check": host.last_check,
                "packet_loss": host.packet_loss,
                "check_count": host.check_count,
                "uptime_percent": host.uptime_percent,
                "is_recording": ip in self._recording,
            })
        return results

    def get_host_status(self, ip: str) -> Optional[dict]:
        """Return status of a single host."""
        host = self.hosts.get(ip)
        if not host:
            return None
        return {
            "ip": host.ip,
            "label": host.label,
            "is_online": host.is_online,
            "response_time": host.response_time,
            "last_check": host.last_check,
            "packet_loss": host.packet_loss,
            "check_count": host.check_count,
            "uptime_percent": host.uptime_percent,
            "is_recording": ip in self._recording,
        }

    def get_summary(self) -> dict:
        """Return summary statistics."""
        total = len(self.hosts)
        online = sum(1 for h in self.hosts.values() if h.is_online)
        offline = total - online
        avg_response = None
        online_hosts = [h for h in self.hosts.values() if h.is_online and h.response_time is not None]
        if online_hosts:
            avg_response = round(sum(h.response_time for h in online_hosts) / len(online_hosts), 2)
        recording_count = len(self._recording)
        return {
            "total": total,
            "online": online,
            "offline": offline,
            "avg_response_time": avg_response,
            "recording_count": recording_count,
        }
