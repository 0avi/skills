# Target: VM and On-Premises

No orchestrator. You build the primitives the managed targets give you for free, which makes this the target where the **principles** matter most, because nothing enforces them for you.

Common in regulated work: an on-premises install because data cannot leave the building, or a customer-managed deployment you do not operate.

| The four questions | Answer |
| ------------------ | ------ |
| **How does an artifact become running code?** | Copy a versioned package, switch a symlink, restart the service |
| **How is configuration injected?** | A file outside the release directory, or environment file read by the service manager |
| **What is the rollback primitive?** | **Point the symlink at the previous release and restart** |
| **What is the zero-downtime primitive?** | Two instances behind a load balancer, drained in turn. Otherwise there is downtime |

---

## The releases-and-symlink layout

This is the pattern worth adopting, because it makes rollback a symlink change rather than a redeploy:

```
/opt/app/
  releases/
    2026.09.1-abc1234/        # immutable, one directory per release
    2026.09.2-def5678/
  current -> releases/2026.09.2-def5678
  shared/
    config/application.yml    # survives releases
    logs/
```

```bash
# deploy
install -d "/opt/app/releases/$VERSION"
tar -xzf app.tgz -C "/opt/app/releases/$VERSION"
ln -sfn "/opt/app/releases/$VERSION" /opt/app/current.new
mv -Tf /opt/app/current.new /opt/app/current      # atomic swap
systemctl restart app

# rollback: seconds, no rebuild, no network
ln -sfn "/opt/app/releases/$PREVIOUS" /opt/app/current.new
mv -Tf /opt/app/current.new /opt/app/current
systemctl restart app
```

Three details doing real work:

- **`mv -Tf` is atomic**; `ln -sf` onto an existing symlink is not, and leaves a window where `current` is missing or wrong.
- **Releases are immutable directories.** Never patch in place, or you lose the ability to say what is running.
- **`shared/` survives**, so configuration and logs are not part of the release. That is what lets one artifact serve every environment. See [environments-and-promotion.md](environments-and-promotion.md).

Keep enough releases to cover your rollback window, and prune by count rather than age.

## The service manager

```ini
# /etc/systemd/system/app.service
[Service]
Type=notify
ExecStart=/usr/bin/java -jar /opt/app/current/app.jar
EnvironmentFile=/opt/app/shared/app.env
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
KillSignal=SIGTERM
User=app
Group=app
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/app/shared/logs
```

- **`TimeoutStopSec` must exceed your drain time**, or systemd escalates to `SIGKILL` and in-flight requests die.
- **`Restart=on-failure`** is the local equivalent of a liveness probe. Without it a crashed service stays down.
- **Run as a dedicated non-root user**, with `NoNewPrivileges` and `ProtectSystem`. There is no container boundary here, so these are the isolation you get.
- **`Type=notify`** with readiness notification is closer to a readiness probe than `Type=simple`, which reports started as soon as the process spawns.

On Windows, the equivalent concerns are a service wrapper, a recovery action, and a service account that is not `LocalSystem`.

## Zero downtime needs two of everything

With one instance, a restart is downtime. There is no way around it. To avoid downtime:

```
        ┌── instance A (drain, deploy, verify, return) ──┐
LB ─────┤                                                 ├──> traffic
        └── instance B (then repeat) ─────────────────────┘
```

The sequence per instance: **remove from the load balancer, wait for connections to drain, deploy, verify health directly, return to the pool.** Then the next one.

**"Remove from the load balancer" must be a real operation**, not a sleep. A health endpoint the load balancer polls, which the application can be told to fail deliberately, is the usual mechanism - and it is the same idea as a readiness probe, built by hand.

If you have one instance and cannot have two, be explicit that deployment means a maintenance window, and schedule it. That is a legitimate choice; pretending otherwise is not.

## Getting the artifact there

| Method | Notes |
| ------ | ----- |
| Package repository (`apt`, `yum`) | Best for on-prem fleets: versioned, signed, auditable |
| Object storage plus a pull script | Simple, and the machine needs no inbound access |
| **Push over SSH from CI** | Common, and requires CI to hold a key and reach the host |
| Configuration management (Ansible, Salt) | Good where you already run it |

**Prefer pull over push.** A machine that pulls needs no inbound access from CI and CI needs no credential for the machine, which removes both the network exposure and the long-lived secret. Push over SSH means a key in CI that can reach production, which is exactly the credential OIDC exists to eliminate everywhere else - and here there is usually no federation available.

For air-gapped installs the artifact travels as a signed bundle. **Verify the signature on arrival**, which is the one place `cosign`'s offline path matters, and it is more involved on cosign v3 than v2. See [provenance-and-signing.md](provenance-and-signing.md).

## Migrations

Same rules, no orchestrator to help: a **separate step before the restart**, with its own credentials, never from application startup - which matters even more here, because a startup migration on two instances behind a load balancer means two concurrent attempts. Expand-only, because during a rolling instance-by-instance deploy both versions are live. See [database-migrations.md](database-migrations.md).

## Version notes

- **`mv -Tf` for an atomic symlink swap.** `ln -sf` onto an existing symlink is not atomic.
- **`TimeoutStopSec` defaults to 90 seconds** on many systemd versions, but do not rely on the default; set it relative to your drain time.
- **Customer-managed installs** need the pipeline to produce a self-contained, signed, verifiable bundle, plus a documented rollback the customer can perform.
- **Not verified here:** no deployment was performed. The systemd unit and shell patterns are standard; nothing in this file was executed on this machine.

## Gotchas

- Agent unpacks over the existing install - loses the ability to say what is running, and rollback becomes a rebuild
- Agent uses `ln -sf` for the swap - not atomic; there is a window where `current` is wrong
- Agent puts configuration inside the release directory - it is lost on the next deploy, and the artifact becomes environment-specific
- Agent sets `TimeoutStopSec` shorter than the drain time - systemd escalates to `SIGKILL` and drops requests
- Agent omits `Restart=on-failure` - a crashed service simply stays down
- Agent runs the service as root - no container boundary, so this is the whole isolation story
- Agent uses `Type=simple` and treats process start as readiness - the load balancer sends traffic too early
- Agent restarts a single instance and calls it zero-downtime - one instance means a maintenance window
- Agent uses a sleep instead of genuinely draining the load balancer - requests are cut mid-flight
- Agent pushes over SSH from CI - a long-lived key in CI that can reach production; prefer pull
- Agent ships an air-gapped bundle and never verifies its signature on arrival - the one place offline verification matters
- Agent migrates from application startup with two instances - two concurrent migration attempts
- Agent prunes old releases by age - prune by count, so the rollback window is preserved during a quiet period

## Related

- [deployment-strategies.md](deployment-strategies.md) · [rollback.md](rollback.md) · [environments-and-promotion.md](environments-and-promotion.md) · [database-migrations.md](database-migrations.md) · [provenance-and-signing.md](provenance-and-signing.md) · [artifacts-and-registries.md](artifacts-and-registries.md) · [oidc-and-secrets.md](oidc-and-secrets.md) · [checklist.md](checklist.md)
