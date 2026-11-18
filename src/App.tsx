import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Utensils,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  MenuItem,
  OrderRecord,
  PanelSettings,
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
  const [porsiInput, setPorsiInput] = useState<string>('1');
  const [tanggalMakan, setTanggalMakan] = useState<TanggalMakan | ''>('');
  const [sesiMakan, setSesiMakan] = useState<SesiMakan | ''>('');
  const [jamMakan, setJamMakan] = useState('');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [buktiPreview, setBuktiPreview] = useState<string>('');
  const [catatan, setCatatan] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const errorAlertRef = useRef<HTMLDivElement | null>(null);

  // UI state
  const [copyToast, setCopyToast] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const jumlahPorsi = useMemo(() => {
    if (!porsiInput.trim()) return 0;
    const parsed = parseInt(porsiInput, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(10000, parsed) : 0;
  }, [porsiInput]);

  // Load menus real-time from Firestore, Auto-Seed if empty, fallback to DEFAULT_MENUS
  useEffect(() => {
    const menusCol = collection(db, 'menus');
    const unsub = onSnapshot(
      menusCol,
      (snapshot) => {
        const list: MenuItem[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as MenuItem);
        });
        list.sort((a, b) => Number(a.urutan ?? 999) - Number(b.urutan ?? 999));
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

  // Step completion indicators
  const step1Done =
    namaSekolah.trim().length >= 2 &&
    namaPj.trim().length >= 2 &&
    /^62[0-9]{7,18}$/.test(standarisasiNomorWA(noWa));
  const step2Done = Boolean(selectedMenu && jumlahPorsi >= 1 && tanggalMakan && sesiMakan && jamMakan);
  const step3Done = Boolean(buktiFile);

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

  const clearSelectedFile = () => {
    setBuktiFile(null);
    setBuktiPreview('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError('');
    const file = e.target.files?.[0] || null;
    if (!file) {
      clearSelectedFile();
      return;
    }

    if (!file.type.startsWith('image/')) {
      setFormError('File bukti transfer harus berupa foto atau gambar (JPG, PNG, WEBP).');
      clearSelectedFile();
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setFormError('Ukuran foto bukti transfer maksimal 3MB. Silakan pilih file yang lebih kecil.');
      clearSelectedFile();
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
    setPorsiInput('1');
    setTanggalMakan('');
    setSesiMakan('');
    setJamMakan('');
    clearSelectedFile();
    setCatatan('');
  };

  const triggerFormError = (message: string) => {
    setFormError(message);
    setTimeout(() => {
      errorAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  const prosesPesanan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError('');

    const cleanSekolah = namaSekolah.trim();
    const cleanPj = namaPj.trim();
    const cleanWa = standarisasiNomorWA(noWa);
    const porsiFinal = jumlahPorsi;
    const cleanCatatan = catatan.trim() || '-';

    if (cleanSekolah.length < 2 || cleanSekolah.length > 150) {
      triggerFormError('Nama Sekolah / Kontingen wajib diisi (2–150 karakter).');
      return;
    }
    if (cleanPj.length < 2 || cleanPj.length > 120) {
      triggerFormError('Nama Official / Penanggung Jawab wajib diisi (2–120 karakter).');
      return;
    }
    if (!/^62[0-9]{7,18}$/.test(cleanWa)) {
      triggerFormError('Nomor WhatsApp tidak valid. Gunakan format 08... atau 628...');
      return;
    }
    if (!selectedMenu) {
      triggerFormError('Silakan pilih salah satu foto paket menu katering terlebih dahulu.');
      return;
    }
    if (!Number.isInteger(porsiFinal) || porsiFinal < 1 || porsiFinal > 10000) {
      triggerFormError('Jumlah porsi pesanan harus antara 1 sampai 10.000 porsi.');
      return;
    }
    if (!tanggalMakan) {
      triggerFormError('Silakan pilih Hari & Tanggal Pengantaran.');
      return;
    }
    if (!sesiMakan) {
      triggerFormError('Silakan pilih Jadwal Pengantaran Makan (Pagi / Siang / Sore).');
      return;
    }
    if (!jamMakan) {
      triggerFormError(`Silakan tentukan pukul berapa ${sesiMakan} dibutuhkan.`);
      return;
    }
    if (!buktiFile) {
      triggerFormError('Wajib mengunggah foto bukti transfer pembayaran.');
      return;
    }
    if (cleanCatatan.length > 500) {
      triggerFormError('Catatan tambahan maksimal 500 karakter.');
      return;
    }

    setIsSubmitting(true);
    const now = new Date();
    const orderId = generateOrderId(now);
    const waktu = formatWaktuJakarta(now);
    const jadwalMakan = `${tanggalMakan} | ${sesiMakan} (Pukul ${jamMakan} WIB)`;
    const hargaSatuan = Math.round(Number(selectedMenu.harga));
    const totalHarga = hargaSatuan * porsiFinal;

    try {
      setSubmitStep('Mengunggah bukti transfer...');
      const { fileUrl } = await uploadBuktiBayar(orderId, buktiFile);

      setSubmitStep('Menyimpan pesanan ke database panitia...');
      const orderPayload: OrderRecord = {
        waktu,
        createdAt: serverTimestamp(),
        orderId,
        namaSekolah: cleanSekolah,
        namaPj: cleanPj,
        noWa: cleanWa,
        namaPaket: selectedMenu.nama,
        hargaSatuan,
        jumlahPorsi: porsiFinal,
        tanggalMakan,
        sesiMakan,
        jamMakan,
        jadwalMakan,
        totalHarga,
        fileUrl,
        catatan: cleanCatatan,
        waTerkirim: false,
        statusPembayaran: 'Pending',
      };

      try {
        await setDoc(doc(db, 'orders', orderId), orderPayload);
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.CREATE, `orders/${orderId}`);
      }

      setSubmitStep('Mengirim kwitansi WhatsApp...');
      const textKwitansi = buatTeksKwitansi({
        orderId,
        namaSekolah: cleanSekolah,
        namaPj: cleanPj,
        namaPaket: selectedMenu.nama,
        jumlahPorsi: porsiFinal,
        jadwalMakan,
        hargaSatuan,
        totalHarga,
        catatan: cleanCatatan,
      });

      const waTerkirim = await kirimPesanWhatsAppOtomatis(
        cleanWa,
        textKwitansi,
        cloudFonnteToken
      );

      if (waTerkirim) {
        try {
          await updateDoc(doc(db, 'orders', orderId), {
            waTerkirim: true,
          });
        } catch (updateWaErr) {
          console.warn('Pesanan tersimpan, gagal memperbarui flag waTerkirim:', updateWaErr);
        }
      }

      setCompletedOrder({ ...orderPayload, waTerkirim });
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
      {/* Top Hero Header — Compact on mobile, executive on desktop */}
      <header className="hero-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="badge-event">LOMBA PASKIBRA GARUDA IV</div>
              <h1 className="text-xl sm:text-2xl md:text-[28px] font-extrabold tracking-tight text-white leading-tight">
                Pemesanan Katering Kontingen
              </h1>
              <p className="text-xs sm:text-sm text-blue-100/85 font-medium">
                SMKS PGRI 1 Sukabumi • Sistem Pemesanan &amp; Kwitansi Otomatis
              </p>
            </div>

            <button
              type="button"
              className="btn-panitia shrink-0"
              onClick={() => setAdminOpen(true)}
              title="Panel Panitia & Pengaturan"
            >
              <Settings className="w-3.5 h-3.5 text-amber-300" />
              <span>Panitia</span>
            </button>
          </div>

          {/* Progress Stepper */}
          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
            <div
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 border text-[11px] sm:text-xs font-semibold transition ${
                step1Done
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                  : 'bg-white/10 border-white/15 text-blue-100'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  step1Done ? 'bg-emerald-400 text-slate-950' : 'bg-amber-400 text-slate-950'
                }`}
              >
                {step1Done ? '✓' : '1'}
              </span>
              <span className="truncate">Data Kontingen</span>
            </div>

            <div
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 border text-[11px] sm:text-xs font-semibold transition ${
                step2Done
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                  : 'bg-white/10 border-white/15 text-blue-100'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  step2Done ? 'bg-emerald-400 text-slate-950' : 'bg-white/20 text-white'
                }`}
              >
                {step2Done ? '✓' : '2'}
              </span>
              <span className="truncate">Menu &amp; Jadwal</span>
            </div>

            <div
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 border text-[11px] sm:text-xs font-semibold transition ${
                step3Done
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                  : 'bg-white/10 border-white/15 text-blue-100'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  step3Done ? 'bg-emerald-400 text-slate-950' : 'bg-white/20 text-white'
                }`}
              >
                {step3Done ? '✓' : '3'}
              </span>
              <span className="truncate">Bayar &amp; Bukti</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content — 2-Column Split Layout on Desktop, Clean 1-Column on Mobile */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-5 sm:mt-7">
        <form
          id="orderForm"
          onSubmit={prosesPesanan}
          noValidate
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start"
        >
          {/* LEFT COLUMN (7/12): FORM STEPS */}
          <div className="lg:col-span-7 space-y-5">
            {/* STEP 1: DATA KONTINGEN & OFFICIAL */}
            <section className="pro-card p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#0b1f3a] text-amber-300 flex items-center justify-center font-extrabold text-xs">
                    01
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                      Data Kontingen &amp; Official
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Identitas sekolah dan nomor WhatsApp penerima kwitansi
                    </p>
                  </div>
                </div>
                {step1Done && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
              </div>

              <div>
                <label htmlFor="namaSekolah" className="field-label">
                  Nama Sekolah / Kontingen <span className="field-required">*</span>
                </label>
                <input
                  type="text"
                  id="namaSekolah"
                  className="field-input"
                  placeholder="Contoh: SMA Negeri 1 Sukabumi"
                  maxLength={150}
                  value={namaSekolah}
                  onChange={(e) => setNamaSekolah(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="namaPj" className="field-label">
                    Nama Official / Penanggung Jawab <span className="field-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="namaPj"
                    className="field-input"
                    placeholder="Nama lengkap official"
                    maxLength={120}
                    value={namaPj}
                    onChange={(e) => setNamaPj(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="noWa" className="field-label">
                    Nomor WhatsApp Aktif <span className="field-required">*</span>
                  </label>
                  <input
                    type="tel"
                    id="noWa"
                    className="field-input"
                    placeholder="Contoh: 081234567890"
                    maxLength={20}
                    value={noWa}
                    onChange={(e) => setNoWa(e.target.value)}
                    required
                  />
                </div>
              </div>
            </section>

            {/* STEP 2: PILIHAN MENU & WAKTU KONSUMSI */}
            <section className="pro-card p-4 sm:p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#0b1f3a] text-amber-300 flex items-center justify-center font-extrabold text-xs">
                    02
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                      Pilihan Menu &amp; Waktu Konsumsi
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Ketuk kartu paket menu, atur porsi, dan tentukan jadwal antar
                    </p>
                  </div>
                </div>
                {step2Done && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
              </div>

              {/* Menu Gallery */}
              <div>
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
                            <span className="text-[11px] font-medium text-slate-500"> / porsi</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Stepper Jumlah Porsi */}
              <div>
                <label htmlFor="jumlahPorsi" className="field-label">
                  Jumlah Porsi Pesanan <span className="field-required">*</span>
                </label>
                <div className="inline-flex items-center border-1.5 border-slate-300 rounded-xl bg-white overflow-hidden w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, (jumlahPorsi || 1) - 1);
                      setPorsiInput(String(next));
                    }}
                    className="w-12 h-11 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-700 border-r border-slate-200 transition cursor-pointer"
                    aria-label="Kurangi jumlah porsi"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    id="jumlahPorsi"
                    className="w-full sm:w-28 h-11 text-center text-base font-extrabold text-slate-900 bg-white outline-none"
                    min={1}
                    max={10000}
                    inputMode="numeric"
                    value={porsiInput}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, '');
                      if (!digits) {
                        setPorsiInput('');
                        return;
                      }
                      const clamped = Math.min(10000, parseInt(digits, 10));
                      setPorsiInput(String(clamped));
                    }}
                    onBlur={() => {
                      if (!porsiInput.trim() || jumlahPorsi < 1) {
                        setPorsiInput('1');
                      }
                    }}
                    onKeyDown={cegahEnterSubmit}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(10000, (jumlahPorsi || 0) + 1);
                      setPorsiInput(String(next));
                    }}
                    className="w-12 h-11 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-700 border-l border-slate-200 transition cursor-pointer"
                    aria-label="Tambah jumlah porsi"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Hari & Tanggal Pengantaran */}
              <div>
                <span className="field-label">
                  Hari &amp; Tanggal Pengantaran <span className="field-required">*</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

              {/* Jadwal Pengantaran Makan / Sesi */}
              <div>
                <span className="field-label">
                  Jadwal Pengantaran Makan <span className="field-required">*</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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

              {/* Dynamic Jam Makan Input */}
              <div
                id="jamMakanContainer"
                className={sesiMakan ? 'jam-makan-container' : 'hidden'}
              >
                <label htmlFor="jamMakan" id="jamMakanLabel" className="field-label mb-0">
                  Pukul Berapa {sesiMakan || 'Makan'} Dibutuhkan? (WIB)
                </label>
                <input
                  type="time"
                  id="jamMakan"
                  className="field-input sm:max-w-[200px]"
                  value={jamMakan}
                  onChange={(e) => setJamMakan(e.target.value)}
                  required={Boolean(sesiMakan)}
                />
              </div>
            </section>

            {/* STEP 3: KONFIRMASI & BUKTI PEMBAYARAN */}
            <section className="pro-card p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#0b1f3a] text-amber-300 flex items-center justify-center font-extrabold text-xs">
                    03
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                      Bukti Transfer &amp; Catatan
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Unggah foto/screenshot bukti transfer sesuai nominal total bayar
                    </p>
                  </div>
                </div>
                {step3Done && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
              </div>

              <div>
                <label htmlFor="buktiBayar" className="field-label">
                  Upload Bukti Transfer (Foto/Gambar, Maks. 3MB){' '}
                  <span className="field-required">*</span>
                </label>

                <label
                  htmlFor="buktiBayar"
                  className={`mt-1 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition ${
                    buktiFile
                      ? 'border-emerald-400 bg-emerald-50/40'
                      : 'border-slate-300 bg-slate-50 hover:border-[#163a70] hover:bg-blue-50/30'
                  }`}
                >
                  <UploadCloud
                    className={`w-7 h-7 ${buktiFile ? 'text-emerald-600' : 'text-[#163a70]'}`}
                  />
                  <div className="text-xs font-bold text-slate-800">
                    {buktiFile ? 'Ganti Foto Bukti Transfer' : 'Ketuk untuk Pilih Foto Bukti Transfer'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Format JPG, PNG, atau WEBP • Ukuran maksimal 3MB
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="buktiBayar"
                    accept="image/*"
                    onChange={handleFileChange}
                    required
                    className="sr-only"
                  />
                </label>

                {buktiPreview && buktiFile && (
                  <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <img
                      src={buktiPreview}
                      alt="Pratinjau bukti transfer"
                      className="w-20 h-20 rounded-lg object-cover border border-slate-300 shrink-0 bg-white"
                    />
                    <div className="min-w-0 flex-1 text-xs space-y-0.5">
                      <div className="font-bold text-slate-900 truncate">{buktiFile.name}</div>
                      <div className="text-slate-500">
                        {(buktiFile.size / 1024).toFixed(0)} KB • Siap dikirim
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                        <Check className="w-3.5 h-3.5" /> Foto valid
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                      aria-label="Hapus foto bukti"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="catatan" className="field-label">
                  Catatan Tambahan (Opsional)
                </label>
                <textarea
                  id="catatan"
                  rows={2}
                  maxLength={500}
                  className="field-textarea"
                  placeholder="Contoh: Tanpa sambal / diantar ke ruang transit"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                />
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN (5/12): STICKY ORDER SUMMARY & PAYMENT */}
          <aside className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
            <section className="pro-card overflow-hidden">
              <div className="bg-[#0b1f3a] px-5 py-3.5 text-white border-b-2 border-amber-500 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-extrabold tracking-wide uppercase">
                    Ringkasan &amp; Pembayaran
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-amber-200">Real-Time</span>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {/* Live Order Breakdown */}
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-500 flex items-center gap-1.5 shrink-0">
                      <Utensils className="w-3.5 h-3.5 text-slate-400" />
                      Paket Menu
                    </span>
                    <span className="font-bold text-slate-900 text-right">
                      {selectedMenu ? selectedMenu.nama : 'Belum dipilih'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Harga × Porsi</span>
                    <span className="font-semibold text-slate-800">
                      {selectedMenu
                        ? `Rp ${Number(selectedMenu.harga).toLocaleString('id-ID')} × ${jumlahPorsi} porsi`
                        : '-'}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-500 flex items-center gap-1.5 shrink-0">
                      <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                      Tanggal
                    </span>
                    <span className="font-semibold text-slate-800 text-right">
                      {tanggalMakan || 'Belum dipilih'}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-500 flex items-center gap-1.5 shrink-0">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Sesi &amp; Jam
                    </span>
                    <span className="font-semibold text-slate-800 text-right">
                      {sesiMakan ? `${sesiMakan} (${jamMakan || '--:--'} WIB)` : 'Belum dipilih'}
                    </span>
                  </div>
                </div>

                {/* Total Display Box */}
                <div
                  id="totalDisplay"
                  className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center justify-between gap-2"
                >
                  <span className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
                    Total Bayar
                  </span>
                  <span className="text-lg font-extrabold text-emerald-700 text-right">
                    {selectedMenu
                      ? `Rp ${totalBayar.toLocaleString('id-ID')}`
                      : 'Rp 0'}
                  </span>
                </div>

                {/* SeaBank Transfer Box */}
                <div className="rekening-box">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0b1f3a]">
                    <CreditCard className="w-4 h-4 text-amber-600" />
                    Rekening Transfer Resmi Panitia
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Transfer nominal pas ke rekening: <strong>Bank SeaBank</strong> • A.n.{' '}
                    <strong>DIYANTO</strong>
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

                {/* Error Feedback */}
                {formError && (
                  <div
                    id="formErrorAlert"
                    ref={errorAlertRef}
                    role="alert"
                    className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700"
                  >
                    {formError}
                  </div>
                )}

                {/* Main Submit CTA */}
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

                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Kwitansi digital resmi otomatis dikirim ke WhatsApp</span>
                </div>
              </div>
            </section>
          </aside>
        </form>
      </main>

      {/* Mobile Sticky Bottom Checkout Bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5 shadow-[0_-6px_20px_rgba(11,31,58,0.08)]">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Total Bayar ({jumlahPorsi} Porsi)
            </div>
            <div className="text-base font-extrabold text-[#0b1f3a] truncate">
              Rp {totalBayar.toLocaleString('id-ID')}
            </div>
          </div>
          <button
            type="submit"
            form="orderForm"
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#0b1f3a] to-[#163a70] text-white text-xs font-extrabold shadow-md disabled:opacity-60 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Memproses...
              </>
            ) : (
              'Kirim Pesanan'
            )}
          </button>
        </div>
      </div>

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
