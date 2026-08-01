package collectors

import (
	"testing"

	"easyzfs/internal/model"
)

// La vista Tareas solo debe mostrar tareas del sistema relacionadas con ZFS:
// snapshots, scrubs y herramientas del ecosistema. Timers como logrotate,
// apt-daily, xfs_scrub_all o e2scrub_all NO son ZFS aunque digan "scrub".
func TestIsZFSTask(t *testing.T) {
	yes := []model.SysTimer{
		{Name: "zfs-auto-snapshot-daily.timer"},
		{Name: "sanoid.timer"},
		{Name: "sanoid-prune.service", Command: "sanoid --prune-snapshots"},
		{Name: "zrepl.service", Command: "/usr/bin/zrepl daemon"},
		{Name: "backup.timer", Command: "/usr/bin/syncoid tank/data backup/data"},
		{Name: "scrub-raid.timer", Command: "/usr/sbin/zpool scrub raid"},
		{Name: "snap.timer", Command: "/usr/sbin/zfs snapshot tank@daily"},
		{Name: "zed.service"},
		{Name: "cron", Schedule: "0 3 * * 0", Command: "zpool scrub tank", Origin: "/etc/cron.d/zfs"},
		{Name: "znapzend.service"},
	}
	no := []model.SysTimer{
		{Name: "logrotate.timer"},
		{Name: "apt-daily.timer"},
		{Name: "xfs_scrub_all.timer"}, // dice scrub pero es XFS
		{Name: "e2scrub_all.timer"},   // idem ext4
		{Name: "fstrim.timer"},
		{Name: "pve-daily-update.timer"},
		{Name: "man-db.timer"},
		{Name: "snap-photos.timer", Command: "rsync -a /photos /backup"}, // snapshot de ficheros, no ZFS
		{Name: ""},
	}
	for _, tt := range yes {
		if !isZFSTask(tt) {
			t.Errorf("%+v debería ser tarea ZFS", tt)
		}
	}
	for _, tt := range no {
		if isZFSTask(tt) {
			t.Errorf("%+v NO debería ser tarea ZFS", tt)
		}
	}
}
