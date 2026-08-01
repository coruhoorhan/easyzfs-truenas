// Package executil — ejecución defensiva de comandos del sistema.
// Reglas del skill: CommandContext con timeout, args separados (NUNCA shell),
// un comando que falla degrada la métrica, jamás tumba el proceso.
package executil

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// ErrTimeout indica que el comando superó su timeout.
var ErrTimeout = errors.New("timeout ejecutando comando")

// useSudo decide si los comandos privilegiados (zpool, zfs, smartctl, lsblk, crontab)
// se ejecutan vía `sudo -n`:
//   - EASYZFS_SUDO=1/true/yes → siempre sudo; =0/false/no → nunca.
//   - Sin override (auto): sudo solo si el proceso NO corre como root (euid != 0).
//
// NoNewPrivileges=yes en systemd rompería sudo; el unit lo evita (ver deploy/).
var useSudo = detectSudo()

func detectSudo() bool {
	switch v := strings.ToLower(os.Getenv("EASYZFS_SUDO")); v {
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	}
	return os.Geteuid() != 0
}

// SudoEnabled expone la decisión (para logs/tests).
func SudoEnabled() bool { return useSudo }

// RunDirect ejecuta name sin anteponer sudo NUNCA (para comandos que no
// necesitan root aunque el proceso corra sin privilegios, p. ej.
// `systemctl list-timers` o `crontab -l` del propio usuario).
func RunDirect(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	out, err := cmd.Output()
	if cctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s: %w tras %s", name, ErrTimeout, timeout)
	}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("%s: %s", name, trimErr(ee.Stderr))
		}
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return out, nil
}

// Run ejecuta name con args y devuelve stdout. Nunca interpolar en shell.
// Si el proceso no es root (o EASYZFS_SUDO=1), antepone `sudo -n`.
func Run(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
	orig := name // para mensajes de error legibles
	if useSudo {
		args = append([]string{"-n", name}, args...)
		name = "sudo"
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	out, err := cmd.Output()
	if cctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s: %w tras %s", orig, ErrTimeout, timeout)
	}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("%s: %s", orig, trimErr(ee.Stderr))
		}
		return nil, fmt.Errorf("%s: %w", orig, err)
	}
	return out, nil
}

// trimErr recorta stderr para mensajes de error legibles (máx. 200 chars).
func trimErr(b []byte) string {
	s := string(b)
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}
