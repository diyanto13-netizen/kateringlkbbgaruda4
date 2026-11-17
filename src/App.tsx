import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { Check, Loader2, Upload } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  MenuItem,
  OrderRecord,
  SesiMakan,
  TanggalMakan,
} from './types/catering';
import {
  bersihkanUrlGambar,
  buatTeksKwitansi,
  DEFAULT_ADMIN_PIN,
  DEFAULT_FONNTE_TOKEN,
  DEFAULT_MENUS,
  FALLBACK_IMAGE_SVG,
  formatWaktuJakarta,
  generateOrderId,
  kirimPesanWhatsAppOtomatis,
  standarisasiNomorWA,
  uploadBuktiBayar,
} from './utils/cateringHelpers';
import { AdminModal } from './components/AdminModal';
import { ReceiptModal } from './components/ReceiptModal';
import type { PanelSettings } from './types/catering';

export default function App() {
  // Catalog state
  const [firestoreMenus, setFirestoreMenus] = useState<MenuItem[]>([]);
  const [hasFirestoreMenus, setHasFirestoreMenus] = useState(false);
  const autoSeedAttemptedRef = useRef(false);

  // Cloud settings state (/settings/panel)
  const [cloudAdminPin, setCloudAdminPin] = useState<string>(DEFAULT_ADMIN_PIN);
  const [cloudFonnteToken, setCloudFonnteToken] = useState<string>(DEFAULT_FONNTE_TOKEN);
  const [settingsLoadedFromCloud, setSettingsLoadedFromCloud] = useState(false);
  const autoSeedSettingsAttemptedRef = useRef(false);

  // Form fields state
  const [namaSekolah, setNamaSekolah] = useState('');
  const [namaPj, setNamaPj] = useState('');
  const [noWa, setNoWa] = useState('');
  const [selectedMenuId, setSelectedMenuId] = useState<string>('');
  const [jumlahPorsi, setJumlahPorsi] = useState<number>(1);
  const [tanggalMakan, setTanggalMakan] = useState<TanggalMakan | ''>('');
  const [sesiMakan, setSesiMakan] = useState<SesiMakan | ''>('');
  const [jamMakan, setJamMakan] = useState('');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [buktiPreview, setBuktiPreview] = useState<string>('');
  const [catatan, setCatatan] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // UI state
  const [copyToast, setCopyToast] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // Load menus real-time from Firestore, Auto-Seed if empty, fallback to DEFAULT_MENUS
  useEffect(() => {
    const q = query(collection(db, 'menus'), orderBy('urutan', 'asc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: MenuItem[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as MenuItem);
        });
        if (list.length > 0) {
          setFirestoreMenus(list);
          setHasFirestoreMenus(true);
        } else {
          setFirestoreMenus([]);
          setHasFirestoreMenus(false);
          if (!autoSeedAttemptedRef.current) {
            autoSeedAttemptedRef.current = true;
            Promise.all(
              DEFAULT_MENUS.map((item) => setDoc(doc(db, 'menus', item.id), item))
            ).catch((seedErr) => {
              console.warn('Auto-Seeder menus dilewati:', seedErr);
            });
          }
        }
      },
      (error) => {
        console.warn('Gagal memuat katalog menus dari Firestore, memakai menu default:', error);
        setFirestoreMenus([]);
        setHasFirestoreMenus(false);
      }
    );
    return () => unsub();
  }, []);

  // Load cloud settings (/settings/panel) real-time from Firestore & auto-seed if missing
  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'panel');
    const unsub = onSnapshot(
      settingsRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as PanelSettings;
          if (data.adminPin) setCloudAdminPin(data.adminPin);
          if (data.fonnteToken) setCloudFonnteToken(data.fonnteToken);
          setSettingsLoadedFromCloud(true);
        } else if (!autoSeedSettingsAttemptedRef.current) {
          autoSeedSettingsAttemptedRef.current = true;
          setDoc(settingsRef, {
            adminPin: DEFAULT_ADMIN_PIN,
            fonnteToken: DEFAULT_FONNTE_TOKEN,
            updatedAt: serverTimestamp(),
          }).catch((seedErr) => {
            console.warn('Auto-Seeder settings/panel dilewati:', seedErr);
          });
        }
      },
      (error) => {
        console.warn('Gagal memuat settings/panel dari Firestore, memakai nilai default:', error);
      }
    );
    return () => unsub();
  }, []);

  const displayedMenus = useMemo(() => {
    return hasFirestoreMenus ? firestoreMenus : DEFAULT_MENUS;
  }, [hasFirestoreMenus, firestoreMenus]);

  const selectedMenu = useMemo(() => {
    return displayedMenus.find((m) => m.id === selectedMenuId) || null;
  }, [displayedMenus, selectedMenuId]);

  const kalkulasiTotal = (): number => {
    if (!selectedMenu) return 0;
    const porsiValid = Number.isFinite(jumlahPorsi) && jumlahPorsi >= 1 ? jumlahPorsi : 0;
    return Number(selectedMenu.harga) * porsiValid;
  };

  const totalBayar = kalkulasiTotal();

  const cegahEnterSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const onSesiChanged = (sesi: SesiMakan) => {
    setSesiMakan(sesi);
    if (!jamMakan) {
      if (sesi === 'Makan Pagi') setJamMakan('07:00');
      else if (sesi === 'Makan Siang') setJamMakan('12:00');
      else setJamMakan('18:00');
    }
  };

  const salinRekening = async () => {
    const noRek = '901474399184';
    try {
      await navigator.clipboard.writeText(noRek);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = noRek;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2500);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError('');
    const file = e.target.files?.[0] || null;
    if (!file) {
      setBuktiFile(null);
      setBuktiPreview('');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setFormError('File bukti transfer harus berupa foto atau gambar (JPG, PNG, WEBP).');
      e.target.value = '';
      setBuktiFile(null);
      setBuktiPreview('');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setFormError('Ukuran foto bukti transfer maksimal 3MB. Silakan pilih file yang lebih kecil.');
      e.target.value = '';
      setBuktiFile(null);
      setBuktiPreview('');
      return;
    }

    setBuktiFile(file);
    const previewUrl = URL.createObjectURL(file);
    setBuktiPreview(previewUrl);
  };

  useEffect(() => {
    return () => {
      if (buktiPreview) {
        URL.revokeObjectURL(buktiPreview);
      }
    };
  }, [buktiPreview]);

  const resetForm = () => {
    setNamaSekolah('');
    setNamaPj('');
    setNoWa('');
    setSelectedMenuId('');
    setJumlahPorsi(1);
    setTanggalMakan('');
    setSesiMakan('');
    setJamMakan('');
    setBuktiFile(null);
    setBuktiPreview('');
    setCatatan('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const prosesPesanan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError('');

    const cleanSekolah = namaSekolah.trim();
    const cleanPj = namaPj.trim();
    const cleanWa = standarisasiNomorWA(noWa);

    if (cleanSekolah.length < 2) {
      setFormError('Nama Sekolah / Kontingen wajib diisi (minimal 2 karakter).');
      return;
    }
    if (cleanPj.length < 2) {
      setFormError('Nama Official / Penanggung Jawab wajib diisi.');
      return;
    }
    if (!/^62[0-9]{7,18}$/.test(cleanWa)) {
      setFormError('Nomor WhatsApp tidak valid. Gunakan format 08... atau 628...');
      return;
    }
    if (!selectedMenu) {
      setFormError('Silakan pilih salah satu foto paket menu katering terlebih dahulu.');
      return;
    }
    if (!Number.isFinite(jumlahPorsi) || jumlahPorsi < 1) {
      setFormError('Jumlah porsi pesanan minimal 1 porsi.');
      return;
    }
    if (!tanggalMakan) {
      setFormError('Silakan pilih Hari & Tanggal Pengantaran.');
      return;
    }
    if (!sesiMakan) {
      setFormError('Silakan pilih Jadwal Pengantaran Makan (Pagi / Siang / Sore).');
      return;
    }
    if (!jamMakan) {
      setFormError(`Silakan tentukan pukul berapa ${sesiMakan} dibutuhkan.`);
      return;
    }
    if (!buktiFile) {
      setFormError('Wajib mengunggah foto bukti transfer pembayaran.');
      return;
    }

    setIsSubmitting(true);
    const now = new Date();
    const orderId = generateOrderId(now);
    const waktu = formatWaktuJakarta(now);
    const jadwalMakan = `${tanggalMakan} | ${sesiMakan} (Pukul ${jamMakan} WIB)`;
    const totalHarga = Number(selectedMenu.harga) * Number(jumlahPorsi);
    const cleanCatatan = catatan.trim() || '-';

    try {
      setSubmitStep('Mengunggah bukti transfer...');
      const { fileUrl } = await uploadBuktiBayar(orderId, buktiFile);

      setSubmitStep('Mengirim kwitansi WhatsApp...');
      const textKwitansi = buatTeksKwitansi({
        orderId,
        namaSekolah: cleanSekolah,
        namaPj: cleanPj,
        namaPaket: selectedMenu.nama,
        jumlahPorsi,
        jadwalMakan,
        hargaSatuan: selectedMenu.harga,
        totalHarga,
        catatan: cleanCatatan,
      });

      const waTerkirim = await kirimPesanWhatsAppOtomatis(
        cleanWa,
        textKwitansi,
        cloudFonnteToken
      );

      setSubmitStep('Menyimpan pesanan ke database panitia...');
      const orderPayload: OrderRecord = {
        waktu,
        createdAt: serverTimestamp(),
        orderId,
        namaSekolah: cleanSekolah,
        namaPj: cleanPj,
        noWa: cleanWa,
        namaPaket: selectedMenu.nama,
        hargaSatuan: Number(selectedMenu.harga),
        jumlahPorsi: Number(jumlahPorsi),
        tanggalMakan,
        sesiMakan,
        jamMakan,
        jadwalMakan,
        totalHarga,
        fileUrl,
        catatan: cleanCatatan,
        waTerkirim,
      };

      try {
        await setDoc(doc(db, 'orders', orderId), orderPayload);
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.CREATE, `orders/${orderId}`);
      }

      setCompletedOrder(orderPayload);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(`Gagal memproses pesanan: ${msg}`);
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
    }
  };

  return (
    <div className="page-shell">
      <main className="app-card">
        {/* Header Banner */}
        <header className="header-banner">
          <button
            type="button"
            className="btn-panitia"
            onClick={() => setAdminOpen(true)}
            title="Panel Panitia & Pengaturan"
          >
            ⚙️ Panitia
          </button>
          <div className="badge-event">LOMBA PASKIBRA GARUDA IV</div>
          <h1>Pemesanan Katering</h1>
          <p>SMKS PGRI 1 Sukabumi</p>
        </header>

        {/* Form Pemesanan 4 Panel */}
        <form id="orderForm" onSubmit={prosesPesanan} noValidate>
          {/* PANEL 1: Data Kontingen & Official */}
          <section className="form-panel panel-kontingen">
            <h2 className="panel-header">1. Data Kontingen &amp; Official</h2>

            <div className="field-group">
              <label htmlFor="namaSekolah" className="field-label">
                Nama Sekolah / Kontingen <span className="field-required">*</span>
              </label>
              <input
                type="text"
                id="namaSekolah"
                className="field-input"
                placeholder="Contoh: SMA Negeri 1 Sukabumi"
                value={namaSekolah}
                onChange={(e) => setNamaSekolah(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label htmlFor="namaPj" className="field-label">
                Nama Official / Penanggung Jawab <span className="field-required">*</span>
              </label>
              <input
                type="text"
                id="namaPj"
                className="field-input"
                placeholder="Nama lengkap official"
                value={namaPj}
                onChange={(e) => setNamaPj(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label htmlFor="noWa" className="field-label">
                Nomor WhatsApp Aktif <span className="field-required">*</span>
              </label>
              <input
                type="tel"
                id="noWa"
                className="field-input"
                placeholder="Contoh: 081234567890"
                value={noWa}
                onChange={(e) => setNoWa(e.target.value)}
                required
              />
            </div>
          </section>

          {/* PANEL 2: Pilihan Menu & Waktu Konsumsi */}
          <section className="form-panel panel-menu">
            <h2 className="panel-header">2. Pilihan Menu &amp; Waktu Konsumsi</h2>

            <div className="field-group">
              <span className="field-label">
                Pilih Paket Menu Katering <span className="field-required">*</span>
              </span>
              <div id="menuGrid" className="menu-grid">
                {displayedMenus.map((menu) => {
                  const isActive = selectedMenuId === menu.id;
                  return (
                    <button
                      type="button"
                      key={menu.id}
                      onClick={() => setSelectedMenuId(menu.id)}
                      className={`menu-item ${isActive ? 'active' : ''}`}
                      aria-pressed={isActive}
                    >
                      <span className="menu-badge">✓ Terpilih</span>
                      <img
                        src={bersihkanUrlGambar(menu.gambar)}
                        alt={menu.nama}
                        className="menu-item-img"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_IMAGE_SVG;
                        }}
                      />
                      <div className="menu-item-body">
                        <div className="menu-item-title">{menu.nama}</div>
                        <div className="menu-item-price">
                          Rp {Number(menu.harga).toLocaleString('id-ID')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="jumlahPorsi" className="field-label">
                Jumlah Porsi Pesanan <span className="field-required">*</span>
              </label>
              <input
                type="number"
                id="jumlahPorsi"
                className="field-input"
                min={1}
                value={jumlahPorsi}
                onChange={(e) => setJumlahPorsi(Math.max(1, Number(e.target.value) || 1))}
                onInput={(e) =>
                  setJumlahPorsi(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))
                }
                onKeyDown={cegahEnterSubmit}
                required
              />
            </div>

            <div className="field-group">
              <span className="field-label">
                Hari &amp; Tanggal Pengantaran <span className="field-required">*</span>
              </span>
              <div className="radio-grid-2">
                <div>
                  <input
                    type="radio"
                    id="tglSabtu"
                    name="tanggalMakan"
                    value="Sabtu, 21 Nop 2026"
                    checked={tanggalMakan === 'Sabtu, 21 Nop 2026'}
                    onChange={() => setTanggalMakan('Sabtu, 21 Nop 2026')}
                    className="radio-hidden"
                  />
                  <label htmlFor="tglSabtu" className="radio-card-tanggal">
                    <span className="tgl-main">Sabtu, 21 Nop 2026</span>
                    <span className="tgl-sub">(Tingkat SD/SMA/SMK/MA)</span>
                  </label>
                </div>

                <div>
                  <input
                    type="radio"
                    id="tglMinggu"
                    name="tanggalMakan"
                    value="Minggu, 22 Nop 2026"
                    checked={tanggalMakan === 'Minggu, 22 Nop 2026'}
                    onChange={() => setTanggalMakan('Minggu, 22 Nop 2026')}
                    className="radio-hidden"
                  />
                  <label htmlFor="tglMinggu" className="radio-card-tanggal">
                    <span className="tgl-main">Minggu, 22 Nop 2026</span>
                    <span className="tgl-sub">(Tingkat SMP/MTS Sederajat)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="field-group">
              <span className="field-label">
                Jadwal Pengantaran Makan <span className="field-required">*</span>
              </span>
              <div className="radio-grid-3">
                <div>
                  <input
                    type="radio"
                    id="sesiPagi"
                    name="sesiMakan"
                    value="Makan Pagi"
                    checked={sesiMakan === 'Makan Pagi'}
                    onChange={() => onSesiChanged('Makan Pagi')}
                    className="radio-hidden"
                  />
                  <label htmlFor="sesiPagi" className="radio-card-sesi sesi-pagi">
                    🌅 Pagi
                  </label>
                </div>

                <div>
                  <input
                    type="radio"
                    id="sesiSiang"
                    name="sesiMakan"
                    value="Makan Siang"
                    checked={sesiMakan === 'Makan Siang'}
                    onChange={() => onSesiChanged('Makan Siang')}
                    className="radio-hidden"
                  />
                  <label htmlFor="sesiSiang" className="radio-card-sesi sesi-siang">
                    ☀️ Siang
                  </label>
                </div>

                <div>
                  <input
                    type="radio"
                    id="sesiSore"
                    name="sesiMakan"
                    value="Makan Sore/Malam"
                    checked={sesiMakan === 'Makan Sore/Malam'}
                    onChange={() => onSesiChanged('Makan Sore/Malam')}
                    className="radio-hidden"
                  />
                  <label htmlFor="sesiSore" className="radio-card-sesi sesi-sore">
                    🌙 Sore / Malam
                  </label>
                </div>
              </div>
            </div>

            <div
              id="jamMakanContainer"
              className={sesiMakan ? 'jam-makan-container' : 'hidden'}
            >
              <label htmlFor="jamMakan" id="jamMakanLabel" className="field-label">
                Pukul Berapa {sesiMakan || 'Makan'} Dibutuhkan?
              </label>
              <input
                type="time"
                id="jamMakan"
                className="field-input"
                value={jamMakan}
                onChange={(e) => setJamMakan(e.target.value)}
                required={Boolean(sesiMakan)}
              />
            </div>
          </section>

          {/* PANEL 3: Rincian Pembayaran */}
          <section className="form-panel panel-pembayaran">
            <h2 className="panel-header">3. Rincian Pembayaran</h2>

            <div id="totalDisplay" className="total-display">
              {selectedMenu
                ? `Total Bayar: Rp ${totalBayar.toLocaleString('id-ID')} (${selectedMenu.nama})`
                : 'Total Bayar: Rp 0 (Pilih foto menu di atas)'}
            </div>

            <div className="rekening-box">
              <div className="rekening-title">💳 Rekening Transfer Resmi Panitia</div>
              <div className="rekening-detail">
                Silakan transfer nominal pas ke rekening: <strong>Bank: SeaBank</strong> |{' '}
                <strong>A.n: DIYANTO</strong>
              </div>
              <div className="rekening-row">
                <span id="noRekText" className="no-rek-text">
                  901474399184
                </span>
                <button
                  type="button"
                  onClick={salinRekening}
                  className="btn-salin-rek inline-flex items-center gap-1"
                >
                  {copyToast ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Tersalin!
                    </>
                  ) : (
                    'Salin Rekening'
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* PANEL 4: Konfirmasi & Bukti Pembayaran */}
          <section className="form-panel panel-bukti">
            <h2 className="panel-header">4. Konfirmasi &amp; Bukti Pembayaran</h2>

            <div className="field-group">
              <label htmlFor="buktiBayar" className="field-label">
                Upload Bukti Transfer (Foto/Gambar, Maks. 3MB){' '}
                <span className="field-required">*</span>
              </label>
              <div className="relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  id="buktiBayar"
                  accept="image/*"
                  onChange={handleFileChange}
                  required
                  className="field-input file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
              </div>

              {buktiPreview && buktiFile && (
                <div className="mt-2 flex items-center gap-3 p-2.5 rounded-lg bg-white border border-slate-200">
                  <img
                    src={buktiPreview}
                    alt="Pratinjau bukti transfer"
                    className="w-16 h-16 rounded-md object-cover border border-slate-200 shrink-0"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-bold text-slate-800 truncate">{buktiFile.name}</div>
                    <div className="text-slate-500">
                      {(buktiFile.size / 1024).toFixed(0)} KB • Siap dikirim
                    </div>
                  </div>
                  <Upload className="w-4 h-4 text-emerald-600 shrink-0" />
                </div>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="catatan" className="field-label">
                Catatan Tambahan (Opsional)
              </label>
              <textarea
                id="catatan"
                rows={2}
                className="field-textarea"
                placeholder="Contoh: Tanpa sambal / diantar ke ruang transit"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
              />
            </div>
          </section>

          {/* Error Feedback */}
          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-semibold text-red-700"
            >
              {formError}
            </div>
          )}

          {/* Tombol Submit Utama */}
          <button
            type="submit"
            id="btnSubmit"
            disabled={isSubmitting}
            className="btn-submit-main"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {submitStep || 'Memproses Pesanan...'}
              </>
            ) : (
              'Kirim Pesanan & Dapatkan Kwitansi'
            )}
          </button>
        </form>
      </main>

      {/* Modal Kwitansi Digital Resmi */}
      <ReceiptModal order={completedOrder} onClose={() => setCompletedOrder(null)} />

      {/* Modal Panel Panitia / Admin */}
      <AdminModal
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        menus={displayedMenus}
        hasFirestoreMenus={hasFirestoreMenus}
        cloudAdminPin={cloudAdminPin}
        cloudFonnteToken={cloudFonnteToken}
        settingsLoadedFromCloud={settingsLoadedFromCloud}
      />
    </div>
  );
}
