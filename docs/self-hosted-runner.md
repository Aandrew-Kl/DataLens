# Self-Hosted GitHub Actions Runner

If the repo is private and the monthly GitHub Actions minutes allowance is exhausted, or if you simply prefer not to consume hosted-runner minutes, you can run CI on a machine you control. Self-hosted runners are free regardless of repo visibility.

## Why this exists

DataLens' CI runs ~6 minutes per PR across four jobs (backend / frontend / security / e2e). A busy week of Wave iterations on a private repo hits the GitHub free tier's 2,000-minute ceiling quickly. Self-hosting a runner on a local laptop or a small cloud VM removes that ceiling.

## Prerequisites

- A machine reachable from the internet (or an always-on laptop)
- Docker (for the e2e job) + Node 22 + Python 3.12
- ~2 GB free disk for the runner's work directory

## Setup

1. Go to `Settings → Actions → Runners → New self-hosted runner`.
2. Pick the OS matching your machine (Linux/macOS/Windows).
3. Copy and run the download + `config.sh` commands GitHub shows. You will choose a name (e.g. `datalens-dev-laptop`) and default group.
4. Install the runner as a service so it survives reboots:
   - Linux: `sudo ./svc.sh install && sudo ./svc.sh start`
   - macOS: `./svc.sh install && ./svc.sh start`
5. Confirm the runner appears as `Online` in the GitHub UI.

## Switching CI to the self-hosted runner

Edit `.github/workflows/ci.yml`:

```yaml
jobs:
  frontend:
    runs-on: self-hosted   # was: ubuntu-latest
    steps: ...
  backend:
    runs-on: self-hosted
    steps: ...
```

Do not mix-and-match runner labels in a single PR — either all jobs use `self-hosted`, or all use `ubuntu-latest`. Mixing works but makes reading the run pages confusing.

## Caveats

- **Security**: a self-hosted runner executes arbitrary workflow code from any PR, including from forks if the repo ever goes public. If you plan to make the repo public, do not use a self-hosted runner without gating via `environment` approval on every workflow run.
- **Caching**: GitHub's `actions/cache` uploads still use GitHub-hosted storage. The 10 GB per-repo cache limit still applies. Run `gh api /repos/<owner>/<repo>/actions/caches` and delete stale entries if you see cache pressure.
- **Idle shutdown**: if the machine sleeps, workflows queue until it wakes. Use `caffeinate -s` (macOS) or `systemd-inhibit` (Linux) in a tmux session.
- **Docker-in-Docker**: the e2e job pulls Playwright browsers with apt dependencies. Use a Linux runner (or a Linux VM on macOS) for that job; pure macOS runners work for everything else.

## Recovery path

If you want to go back to hosted runners (e.g. after the monthly quota resets), revert the `runs-on: self-hosted` change and the hosted runners pick the jobs back up automatically. No extra teardown required.
