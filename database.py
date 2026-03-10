"""
Network Monitor - PostgreSQL Database Module
Uses asyncpg for async database operations.
"""

import asyncpg
from typing import Optional, List, Dict
from datetime import datetime

# Global connection pool
_pool: Optional[asyncpg.Pool] = None

# Default DSN
DEFAULT_DSN = "postgresql://postgres:postgres@localhost:5432/network_monitor"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS hosts (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(45) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ping_records (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
    response_time FLOAT,
    is_online BOOLEAN NOT NULL,
    recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ping_records_host_time
    ON ping_records(host_id, recorded_at DESC);
"""


async def init_db(dsn: str = DEFAULT_DSN):
    """Initialize the database connection pool and create tables."""
    global _pool

    # First, try to create the database if it doesn't exist
    try:
        sys_dsn = dsn.rsplit("/", 1)[0] + "/postgres"
        sys_conn = await asyncpg.connect(sys_dsn)
        try:
            db_name = dsn.rsplit("/", 1)[1].split("?")[0]
            exists = await sys_conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", db_name
            )
            if not exists:
                await sys_conn.execute(f'CREATE DATABASE "{db_name}"')
                print(f"[DB] Created database '{db_name}'")
        finally:
            await sys_conn.close()
    except Exception as e:
        print(f"[DB] Note: Could not auto-create database: {e}")

    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    async with _pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    print("[DB] Database initialized successfully")


async def close_db():
    """Close the database connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        print("[DB] Connection pool closed")


async def add_host(ip: str, label: str) -> Dict:
    """Add a new host to the database. Returns the created host."""
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO hosts (ip, label)
            VALUES ($1, $2)
            ON CONFLICT (ip) DO UPDATE SET label = $2
            RETURNING id, ip, label, created_at
            """,
            ip, label,
        )
        return dict(row)


async def remove_host(ip: str) -> bool:
    """Remove a host from the database. Returns True if deleted."""
    async with _pool.acquire() as conn:
        result = await conn.execute("DELETE FROM hosts WHERE ip = $1", ip)
        return result == "DELETE 1"


async def get_all_hosts() -> List[Dict]:
    """Get all hosts from the database."""
    async with _pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, ip, label, created_at FROM hosts ORDER BY id")
        return [dict(r) for r in rows]


async def save_ping_record(ip: str, response_time: Optional[float], is_online: bool):
    """Save a ping record for a host."""
    async with _pool.acquire() as conn:
        host_id = await conn.fetchval("SELECT id FROM hosts WHERE ip = $1", ip)
        if host_id is None:
            return
        await conn.execute(
            """
            INSERT INTO ping_records (host_id, response_time, is_online)
            VALUES ($1, $2, $3)
            """,
            host_id, response_time, is_online,
        )


async def get_ping_history(ip: str, limit: int = 60) -> List[Dict]:
    """
    Get ping history for a host.
    Default limit=60 means last 60 records (5 minutes at 5s intervals).
    """
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT pr.response_time, pr.is_online, pr.recorded_at
            FROM ping_records pr
            JOIN hosts h ON h.id = pr.host_id
            WHERE h.ip = $1
            ORDER BY pr.recorded_at DESC
            LIMIT $2
            """,
            ip, limit,
        )
        # Return in chronological order
        result = []
        for r in reversed(rows):
            result.append({
                "response_time": r["response_time"],
                "is_online": r["is_online"],
                "recorded_at": r["recorded_at"].strftime("%Y-%m-%d %H:%M:%S"),
            })
        return result
