package service

import (
	"os"
	"strings"
	"testing"
)

// Create menulis baris transaksi lewat pool sebelum ledger tx berjalan, dan
// ledger tx itu Serializable sehingga kegagalan serialisasi adalah hasil yang
// wajar, bukan kejadian langka. Kalau ledger gagal, tersisa baris pending yang
// sudah ter-commit di bawah idempotency key tersebut.
//
// ProcessRefund mengembalikan baris itu sebagai replay sukses tanpa melihat
// statusnya. Akibatnya refund dilaporkan berhasil padahal tidak ada satu pun
// ledger entry, key sudah terpakai, dan tidak ada percobaan ulang yang tersisa
// di sistem. Uang owner tidak pernah kembali dan tidak ada yang tahu.
//
// ReleaseEscrow menghadapi persoalan yang sama dan sudah diperbaiki: hanya
// status completed atau refunded yang dihitung replay, sisanya dilanjutkan,
// dan LockStatusTx dipakai untuk memutuskan siapa yang menang saat dua
// percobaan berebut key yang sama.
func TestRefundResumesAnUnsettledRow(t *testing.T) {
	src, err := os.ReadFile("payment.go")
	if err != nil {
		t.Fatalf("read payment.go: %v", err)
	}
	body := string(src)

	refund := section(t, body, "func (s *PaymentService) ProcessRefund")

	if !strings.Contains(refund, "TxStatusCompleted") || !strings.Contains(refund, "TxStatusRefunded") {
		t.Error("ProcessRefund tidak memeriksa status sebelum menganggap replay")
	}
	if !strings.Contains(refund, "LockStatusTx") {
		t.Error("ProcessRefund tidak mengunci baris untuk memutuskan pemenang antar percobaan")
	}
}

// Escrow-in punya bentuk yang sama: Create commit dulu, ledger menyusul.
func TestCreateSnapTokenChecksIdempotencyResult(t *testing.T) {
	src, err := os.ReadFile("payment.go")
	if err != nil {
		t.Fatalf("read payment.go: %v", err)
	}
	snap := section(t, string(src), "func (s *PaymentService) CreateSnapToken")

	if !strings.Contains(snap, "IsNew") {
		t.Error("CreateSnapToken membuang hasil idempotency, order id yang dipakai ulang menghasilkan token dengan nominal berbeda dari baris tersimpan")
	}
}

// Ambil isi satu fungsi sampai fungsi berikutnya.
func section(t *testing.T, body, marker string) string {
	t.Helper()
	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatalf("tidak menemukan %s", marker)
	}
	next := strings.Index(body[start+len(marker):], "\nfunc (s *PaymentService)")
	if next < 0 {
		return body[start:]
	}
	return body[start : start+len(marker)+next]
}
