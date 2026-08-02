module easyzfs

go 1.23.0

toolchain go1.23.10

require (
	golang.org/x/crypto v0.36.0 // argon2id para hashes de contraseña (stdlib no lo incluye)
	modernc.org/sqlite v1.34.5 // driver SQLite puro Go (CGO_ENABLED=0, binario estático)
)

require github.com/SherClockHolmes/webpush-go v1.4.0

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/golang-jwt/jwt/v5 v5.2.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/sys v0.31.0 // indirect
	modernc.org/libc v1.55.3 // indirect
	modernc.org/mathutil v1.6.0 // indirect
	modernc.org/memory v1.8.0 // indirect
)
