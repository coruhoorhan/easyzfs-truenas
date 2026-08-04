// smb.go — capa SMB portátil: si el host es TrueNAS usa su middleware
// (midclt); si no (Debian/Proxmox con Samba) usa las herramientas `net conf`.
// Permite que "Animar un clon + SMB" funcione en ambos entornos.
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"easyzfs/internal/executil"
)

// isTrueNAS — ¿el host tiene el middleware de TrueNAS (midclt)?
func isTrueNAS() bool {
	_, err := exec.LookPath("midclt")
	return err == nil
}

// smbReload — recarga la configuración SMB del host sin cortar conexiones.
func (s *Server) smbReload(ctx context.Context) {
	if isTrueNAS() {
		executil.Run(ctx, 15*time.Second, "midclt", "call", "service.reload", "cifs")
		return
	}
	// Samba genérico (Debian/Proxmox).
	executil.Run(ctx, 15*time.Second, "smbcontrol", "all", "reload-config")
}

// smbShareCreate — crea un share SMB de solo lectura (por defecto).
func (s *Server) smbShareCreate(ctx context.Context, name, path string, readOnly bool) error {
	if isTrueNAS() {
		payload := fmt.Sprintf(`{"path": %q, "name": %q, "comment": "EasyZFS Anında Kurtarma", "readonly": %v}`, path, name, readOnly)
		if _, err := executil.Run(ctx, 30*time.Second, "midclt", "call", "sharing.smb.create", payload); err != nil {
			return err
		}
		s.smbReload(ctx)
		return nil
	}
	// Samba genérico: crea el share y fija los parámetros.
	if _, err := executil.Run(ctx, 15*time.Second, "net", "conf", "addshare", name, path); err != nil {
		return fmt.Errorf("net conf addshare: %w", err)
	}
	ro := "no"
	if readOnly {
		ro = "yes"
	}
	set := []struct{ k, v string }{
		{"read only", ro},
		{"writeable", "no"},
		{"guest ok", "no"},
		{"comment", "EasyZFS Anında Kurtarma"},
	}
	for _, p := range set {
		if _, err := executil.Run(ctx, 10*time.Second, "net", "conf", "setparm", name, p.k, p.v); err != nil {
			return fmt.Errorf("net conf setparm %s: %w", p.k, err)
		}
	}
	s.smbReload(ctx)
	return nil
}

// smbShareDelete — elimina un share SMB por nombre (no existe → ok).
func (s *Server) smbShareDelete(ctx context.Context, name string) error {
	if isTrueNAS() {
		out, err := executil.Run(ctx, 15*time.Second, "midclt", "call", "sharing.smb.query")
		if err != nil {
			return err
		}
		var shares []map[string]interface{}
		if err := json.Unmarshal(out, &shares); err != nil {
			return err
		}
		for _, sh := range shares {
			if n, _ := sh["name"].(string); n == name {
				if id, ok := sh["id"].(float64); ok {
					if _, err := executil.Run(ctx, 15*time.Second, "midclt", "call", "sharing.smb.delete", fmt.Sprintf("%d", int(id))); err != nil {
						return err
					}
					s.smbReload(ctx)
					return nil
				}
			}
		}
		return nil
	}
	if _, err := executil.Run(ctx, 15*time.Second, "net", "conf", "delshare", name); err != nil {
		return err
	}
	s.smbReload(ctx)
	return nil
}

// smbShareInfo — un share SMB (para el listado de montajes).
type smbShareInfo struct {
	Name     string
	Path     string
	ReadOnly bool
}

// smbSharesList — lista los shares SMB del host.
func (s *Server) smbSharesList(ctx context.Context) ([]smbShareInfo, error) {
	var list []smbShareInfo
	if isTrueNAS() {
		out, err := executil.Run(ctx, 15*time.Second, "midclt", "call", "sharing.smb.query")
		if err != nil {
			return nil, err
		}
		var shares []map[string]interface{}
		if err := json.Unmarshal(out, &shares); err != nil {
			return nil, err
		}
		for _, sh := range shares {
			n, _ := sh["name"].(string)
			p, _ := sh["path"].(string)
			ro, _ := sh["readonly"].(bool)
			list = append(list, smbShareInfo{Name: n, Path: p, ReadOnly: ro})
		}
		return list, nil
	}
	// Samba genérico: net conf listshares + showshare por share.
	out, err := executil.Run(ctx, 15*time.Second, "net", "conf", "listshares")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		n := strings.TrimSpace(line)
		if n == "" {
			continue
		}
		pout, err := executil.Run(ctx, 10*time.Second, "net", "conf", "showshare", n)
		if err != nil {
			continue
		}
		path := ""
		for _, l := range strings.Split(string(pout), "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "path = ") {
				path = strings.TrimPrefix(l, "path = ")
				break
			}
		}
		list = append(list, smbShareInfo{Name: n, Path: path, ReadOnly: true})
	}
	return list, nil
}