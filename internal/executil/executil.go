// Package executil — ejecución defensiva de comandos del sistema.
// Reglas del skill: CommandContext con timeout, args separados (NUNCA shell),
// un comando que falla degrada la métrica, jamás tumba el proceso.
package executil

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

// ErrTimeout indica que el comando superó su timeout.
var ErrTimeout = errors.New("timeout ejecutando comando")

// Run ejecuta name con args y devuelve stdout. Nunca interpolar en shell.
func Run(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
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
