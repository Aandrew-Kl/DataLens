#!/usr/bin/env python3
"""DataLens orchestration TUI.

Live terminal dashboard for Codex agents + git branches + CI.

Usage:
    /tmp/venv_dl/bin/python scripts/tui.py
    # or (if rich is system-installed):
    python3 scripts/tui.py

Controls:
    Ctrl-C to quit.
"""

from __future__ import annotations

import glob
import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

from rich.console import Console, Group
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text


REPO = "/tmp/DataLens_review"
GH_REPO = "Aandrew-Kl/DataLens"
console = Console()


# ── helpers ────────────────────────────────────────────────────────────────

def run(cmd: list[str], cwd: str | None = None, timeout: int = 5) -> str:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout
    except Exception:
        return ""


def is_alive(pid: str) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def log_tail(path: str, lines: int = 3) -> list[str]:
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            block = min(size, 4096)
            f.seek(-block, 2)
            raw = f.read().decode("utf-8", errors="replace")
        return raw.rstrip().splitlines()[-lines:]
    except Exception:
        return []


def log_growth(path: str, prev_size: int) -> tuple[int, bool]:
    try:
        size = os.path.getsize(path)
    except Exception:
        return prev_size, False
    return size, size > prev_size


def tokens_used(path: str) -> str:
    try:
        with open(path) as f:
            content = f.read()
        matches = re.findall(r"tokens used\s+([\d,]+)", content)
        return matches[-1] if matches else ""
    except Exception:
        return ""


# ── panels ─────────────────────────────────────────────────────────────────

_prev_sizes: dict[str, int] = {}


def agents_table() -> Table:
    tbl = Table(
        title="Codex agents",
        title_style="bold cyan",
        header_style="bold",
        expand=True,
        show_edge=False,
        pad_edge=False,
    )
    tbl.add_column("agent", style="bright_white", width=22)
    tbl.add_column("state", width=8)
    tbl.add_column("log", width=8, justify="right")
    tbl.add_column("Δ", width=3, justify="center")
    tbl.add_column("tokens", width=9, justify="right")
    tbl.add_column("last line", overflow="ellipsis")

    pidfiles = sorted(glob.glob("/tmp/w*_*.pid"))
    for pf in pidfiles:
        base = Path(pf).stem
        pid = Path(pf).read_text().strip() if Path(pf).exists() else ""
        log_path = f"/tmp/{base}.log"
        alive = is_alive(pid)
        size, grew = log_growth(log_path, _prev_sizes.get(base, 0))
        _prev_sizes[base] = size
        size_kb = f"{size // 1024}KB" if size else "0KB"
        state = Text("alive", style="green") if alive else Text("done", style="dim")
        delta = Text("▲", style="yellow bold") if grew and alive else Text(" ")
        tks = tokens_used(log_path)
        tail = log_tail(log_path, 1)
        last = tail[0] if tail else ""
        last = re.sub(r"\x1b\[[0-9;]*m", "", last)  # strip ANSI
        tbl.add_row(base, state, size_kb, delta, tks, last)

    return tbl


def branches_panel() -> Panel:
    content = []
    for branch in ["improvement/wave-3", "improvement/wave-4"]:
        out = run(["git", "-C", REPO, "log", "--oneline", f"main..{branch}"])
        commits = out.strip().splitlines()
        n = len(commits)
        last = commits[0] if commits else "(no commits)"
        content.append(Text.assemble(
            (f"  {branch:<22}", "bold cyan"),
            (f" {n:>2} ahead", "white"),
            " │ ",
            (last[:90], "dim"),
        ))
    return Panel(Group(*content), title="[bold]branches[/bold]", border_style="cyan", padding=(0, 1))


def pr_panel() -> Panel:
    rows = []
    for pr in ("17", "18"):
        meta = run(["gh", "pr", "view", pr, "--json", "state,mergeable,title"], cwd=REPO)
        if not meta.strip():
            continue
        import json as _json
        try:
            d = _json.loads(meta)
        except Exception:
            continue
        title = d.get("title", "")[:70]
        state = d.get("state", "?")
        mergeable = d.get("mergeable", "?")
        checks_raw = run(["gh", "pr", "checks", pr], cwd=REPO).strip().splitlines()[:5]

        rows.append(Text.assemble(
            ("PR #", "bold"), (pr, "bold bright_white"),
            "  ",
            (state, "green" if state == "OPEN" else "dim"),
            "  ",
            (mergeable, "green" if mergeable == "MERGEABLE" else "yellow"),
            "  ",
            (title, "dim"),
        ))
        for ln in checks_raw:
            parts = ln.split("\t")
            if len(parts) >= 2:
                job, status = parts[0], parts[1]
                color = {"pass": "green", "fail": "red", "pending": "yellow", "skipping": "dim"}.get(status, "white")
                rows.append(Text.assemble(
                    "    ",
                    (f"{job:<12}", "white"),
                    (status, color),
                ))
        rows.append(Text(""))

    if not rows:
        rows = [Text("  (no open PRs found)", style="dim")]

    return Panel(Group(*rows), title="[bold]open PRs[/bold]", border_style="cyan", padding=(0, 1))


def cache_panel() -> Panel:
    out = run(["gh", "api", f"/repos/{GH_REPO}/actions/cache/usage"])
    try:
        import json as _json
        d = _json.loads(out)
        b = d["active_caches_size_in_bytes"]
        c = d["active_caches_count"]
        gb = b / (1024 ** 3)
        pct = min(100, gb / 10 * 100)
        fill = int(pct / 5)
        bar = "█" * fill + "░" * (20 - fill)
        color = "green" if gb < 8 else ("yellow" if gb < 10 else "red")
        body = Text.assemble(
            (f"  [{bar}]", color),
            f"  {gb:.2f}/10 GB ({pct:.0f}%)  ·  {c} entries",
        )
    except Exception:
        body = Text("  (unable to read)", style="dim")
    return Panel(body, title="[bold]GH Actions cache[/bold]", border_style="cyan", padding=(0, 1))


def header() -> Panel:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    body = Text.assemble(
        ("DataLens", "bold magenta"),
        " · ",
        ("orchestration TUI", "white"),
        " · ",
        (f"refresh every 3s · Ctrl-C to quit · {now}", "dim"),
    )
    return Panel(body, border_style="magenta")


# ── main loop ──────────────────────────────────────────────────────────────

def build_layout() -> Layout:
    layout = Layout()
    layout.split_column(
        Layout(header(), name="header", size=3),
        Layout(name="body"),
    )
    layout["body"].split_row(
        Layout(Panel(agents_table(), border_style="cyan", padding=(0, 1)), name="agents", ratio=3),
        Layout(name="side", ratio=2),
    )
    layout["body"]["side"].split_column(
        Layout(branches_panel(), size=6),
        Layout(pr_panel()),
        Layout(cache_panel(), size=5),
    )
    return layout


def main() -> None:
    with Live(build_layout(), refresh_per_second=0.5, screen=True) as live:
        try:
            while True:
                time.sleep(3)
                live.update(build_layout())
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
