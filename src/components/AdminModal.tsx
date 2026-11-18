import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  activeConfig,
  db,
  getDefaultConfigJson,
  handleFirestoreError,
  isCustomFirebaseConfigActive,
  LS_FIREBASE_CONFIG_KEY,
  OperationType,
} from '../firebase';
import type { MenuItem, OrderRecord, StatusPembayaran } from '../types/catering';
import {
  bersihkanUrlGambar,
  buatTeksKwitansi,
  DEFAULT_ADMIN_PIN,
  DEFAULT_FONNTE_TOKEN,
  DEFAULT_MENUS,
  FALLBACK_IMAGE_SVG,
  kirimPesanWhatsAppOtomatis,
} from '../utils/cateringHelpers';
import { exportOrdersToExcel } from '../utils/exportExcel';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  menus: MenuItem[];
  hasFirestoreMenus: boolean;
  cloudAdminPin: string;
  cloudFonnteToken: string;
  settingsLoadedFromCloud: boolean;
}

type AdminTab = 'orders' | 'menus' | 'config';

function getOrderTimestampMs(order: OrderRecord): number {
  const raw = order.createdAt as
    | { toMillis?: () => number; seconds?: number; nanoseconds?: number }
    | Date
    | number
    | string
    | null
    | undefined;

  if (raw && typeof raw === 'object') {
    if (typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
      return (raw as { toMillis: () => number }).toMillis();
    }
    if (typeof (raw as { seconds?: number }).seconds === 'number') {
      return (raw as { seconds: number }).seconds * 1000;
    }
    if (raw instanceof Date) {
      return raw.getTime();
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  // Fallback parse dd/MM/yyyy HH:mm:ss
  if (typeof order.waktu === 'string') {
    const m = order.waktu.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+07:00`;
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  menus,
  hasFirestoreMenus,
  cloudAdminPin,
  cloudFonnteToken,
  settingsLoadedFromCloud,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [pinError, setPinError] = useState('');

  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [previewProofOrder, setPreviewProofOrder] = useState<OrderRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'error'>('info');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Pending' | 'Lunas'>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'Sabtu' | 'Minggu'>('ALL');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);
  const [confirmDeleteMenuId, setConfirmDeleteMenuId] = useState<string | null>(null);

  // Menu form state
  const [menuId, setMenuId] = useState('');
  const [menuNama, setMenuNama] = useState('');
  const [menuHarga, setMenuHarga] = useState('');
  const [menuGambar, setMenuGambar] = useState('');
  const [menuUrutan, setMenuUrutan] = useState('1');
  const [menuSaving, setMenuSaving] = useState(false);
  const [seedingMenus, setSeedingMenus] = useState(false);

  // Config state
  const [configJsonInput, setConfigJsonInput] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_FIREBASE_CONFIG_KEY);
      if (saved && saved.trim()) return saved;
    } catch {
      // ignore
    }
    return JSON.stringify(activeConfig, null, 2);
  });
  const [fonnteTokenInput, setFonnteTokenInput] = useState(cloudFonnteToken);
  const [adminPinSetting, setAdminPinSetting] = useState(cloudAdminPin);
  const [configSaving, setConfigSaving] = useState(false);

  const showStatus = (msg: string, type: 'info' | 'error' = 'info') => {
    setStatusMessage(msg);
    setStatusType(type);
  };

  const reportFirestoreFailure = (
    err: unknown,
    op: OperationType,
    path: string,
    fallbackLabel: string
  ) => {
    try {
      handleFirestoreError(err, op, path);
    } catch {
      const msg = err instanceof Error ? err.message : String(err);
      showStatus(`${fallbackLabel}: ${msg}`, 'error');
    }
  };

  useEffect(() => {
    setFonnteTokenInput(cloudFonnteToken);
  }, [cloudFonnteToken]);

  useEffect(() => {
    setAdminPinSetting(cloudAdminPin);
  }, [cloudAdminPin]);

  // Reset error & filter saat modal ditutup agar pesanan terbaru tidak tersembunyi saat dibuka kembali
  useEffect(() => {
    if (!isOpen) {
      setPinError('');
      setStatusMessage('');
      setConfirmDeleteOrderId(null);
      setConfirmDeleteMenuId(null);
      setSearchQuery('');
      setStatusFilter('ALL');
      setDateFilter('ALL');
    }
  }, [isOpen]);

  // Real-time listener orders langsung aktif setelah PIN terverifikasi (tanpa login Google)
  // Mengambil koleksi penuh dan mengurutkan di client agar aman dari kendala index atau doc lama tanpa createdAt
  useEffect(() => {
    if (!isOpen || !pinVerified) {
      return;
    }

    setOrdersLoading(true);
    setOrdersError('');
    const ordersCol = collection(db, 'orders');
    const unsub = onSnapshot(
      ordersCol,
      (snapshot) => {
        const list: OrderRecord[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as OrderRecord);
        });
        list.sort((a, b) => {
          const diff = getOrderTimestampMs(b) - getOrderTimestampMs(a);
          if (diff !== 0) return diff;
          return (b.orderId || '').localeCompare(a.orderId || '');
        });
        setOrders(list);
        setOrdersLoading(false);
      },
      (err) => {
        setOrdersLoading(false);
        const msg = err instanceof Error ? err.message : String(err);
        setOrdersError(`Gagal memuat pesanan dari Firestore: ${msg}`);
      }
    );

    return () => unsub();
  }, [isOpen, pinVerified]);

  const handleRefreshOrders = async () => {
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const snapshot = await getDocsFromServer(collection(db, 'orders'));
      const list: OrderRecord[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as OrderRecord);
      });
      list.sort((a, b) => {
        const diff = getOrderTimestampMs(b) - getOrderTimestampMs(a);
        if (diff !== 0) return diff;
        return (b.orderId || '').localeCompare(a.orderId || '');
      });
      setOrders(list);
      showStatus(`Data rekap berhasil disegarkan langsung dari Cloud (${list.length} pesanan).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrdersError(`Gagal menyegarkan data pesanan dari Firestore: ${msg}`);
    } finally {
      setOrdersLoading(false);
    }
  };

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      const statusBayar: StatusPembayaran =
        o.statusPembayaran === 'Lunas' ? 'Lunas' : 'Pending';
      const tgl = o.tanggalMakan || '';
      if (statusFilter !== 'ALL' && statusBayar !== statusFilter) return false;
      if (dateFilter === 'Sabtu' && !tgl.includes('Sabtu')) return false;
      if (dateFilter === 'Minggu' && !tgl.includes('Minggu')) return false;
      if (q) {
        const hay = `${o.orderId || ''} ${o.namaSekolah || ''} ${o.namaPj || ''} ${o.noWa || ''} ${o.namaPaket || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, searchQuery, statusFilter, dateFilter]);

  const summary = useMemo(() => {
    return filteredOrders.reduce(
      (acc, o) => {
        acc.totalOrders += 1;
        acc.totalPorsi += Number(o.jumlahPorsi || 0);
        acc.totalRevenue += Number(o.totalHarga || 0);
        if (o.statusPembayaran === 'Lunas') {
          acc.lunasCount += 1;
          acc.lunasRevenue += Number(o.totalHarga || 0);
        } else {
          acc.pendingCount += 1;
        }
        return acc;
      },
      { totalOrders: 0, totalPorsi: 0, totalRevenue: 0, lunasCount: 0, pendingCount: 0, lunasRevenue: 0 }
    );
  }, [filteredOrders]);

  if (!isOpen) return null;

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    const expected = cloudAdminPin || DEFAULT_ADMIN_PIN;
    if (pinInput.trim() === expected) {
      setPinVerified(true);
      setPinError('');
      setPinInput('');
    } else {
      setPinError('PIN Panitia salah. Silakan coba lagi.');
    }
  };

  const handleManualSeedMenus = async () => {
    setSeedingMenus(true);
    try {
      for (const item of DEFAULT_MENUS) {
        await setDoc(doc(db, 'menus', item.id), item);
      }
      showStatus('Paket menu contoh berhasil dimuat ke koleksi menus Firestore.');
    } catch (err) {
      reportFirestoreFailure(err, OperationType.WRITE, 'menus', 'Gagal memuat menu contoh');
    } finally {
      setSeedingMenus(false);
    }
  };

  const handleSaveMenu = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawId = menuId.trim();
    const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanNama = menuNama.trim();
    const cleanGambar = menuGambar.trim();
    const numHarga = Math.round(Number(menuHarga));
    const numUrutan = Math.round(Number(menuUrutan || 1));

    if (!rawId || rawId !== cleanId) {
      showStatus(
        'ID Paket hanya boleh berisi huruf, angka, tanda hubung (-), atau garis bawah (_) tanpa spasi.',
        'error'
      );
      return;
    }
    if (cleanId.length > 32) {
      showStatus('ID Paket maksimal 32 karakter.', 'error');
      return;
    }
    if (!cleanNama || cleanNama.length > 150) {
      showStatus('Nama Paket wajib diisi (1–150 karakter).', 'error');
      return;
    }
    if (!Number.isFinite(numHarga) || numHarga <= 0 || numHarga > 10000000) {
      showStatus('Harga satuan harus antara Rp 1 sampai Rp 10.000.000.', 'error');
      return;
    }
    if (cleanGambar.length > 1000) {
      showStatus('URL Foto Menu maksimal 1000 karakter.', 'error');
      return;
    }
    if (!Number.isFinite(numUrutan) || numUrutan < 0 || numUrutan > 10000) {
      showStatus('Urutan tampil harus antara 0 sampai 10.000.', 'error');
      return;
    }

    setMenuSaving(true);
    try {
      await setDoc(doc(db, 'menus', cleanId), {
        id: cleanId,
        nama: cleanNama,
        harga: numHarga,
        gambar: cleanGambar,
        urutan: numUrutan,
      });
      setMenuId('');
      setMenuNama('');
      setMenuHarga('');
      setMenuGambar('');
      setMenuUrutan(String(menus.length + 2));
      showStatus(`Paket menu "${cleanNama}" (${cleanId}) berhasil disimpan ke Firestore.`);
    } catch (err) {
      reportFirestoreFailure(err, OperationType.WRITE, `menus/${cleanId}`, 'Gagal menyimpan menu');
    } finally {
      setMenuSaving(false);
    }
  };

  const handleEditMenuClick = (item: MenuItem) => {
    setMenuId(item.id);
    setMenuNama(item.nama);
    setMenuHarga(String(item.harga));
    setMenuGambar(item.gambar);
    setMenuUrutan(String(item.urutan));
  };

  const handleDeleteMenu = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'menus', id));
      setConfirmDeleteMenuId(null);
      showStatus(`Paket menu ${id} berhasil dihapus dari Firestore.`);
    } catch (err) {
      reportFirestoreFailure(err, OperationType.DELETE, `menus/${id}`, 'Gagal menghapus menu');
    }
  };

  const handleExportExcel = async () => {
    if (filteredOrders.length === 0) return;
    setExportingExcel(true);
    try {
      await exportOrdersToExcel(filteredOrders);
      showStatus(`File Excel (${filteredOrders.length} pesanan) siap cetak berhasil diunduh.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showStatus(`Gagal membuat file Excel: ${msg}`, 'error');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleResendWa = async (order: OrderRecord) => {
    const text = buatTeksKwitansi({
      orderId: order.orderId,
      namaSekolah: order.namaSekolah,
      namaPj: order.namaPj,
      namaPaket: order.namaPaket,
      jumlahPorsi: order.jumlahPorsi,
      jadwalMakan: order.jadwalMakan,
      hargaSatuan: order.hargaSatuan,
      totalHarga: order.totalHarga,
      catatan: order.catatan,
    });

    const ok = await kirimPesanWhatsAppOtomatis(order.noWa, text, cloudFonnteToken);
    if (ok) {
      try {
        await updateDoc(doc(db, 'orders', order.orderId), {
          waTerkirim: true,
          statusPembayaran: order.statusPembayaran === 'Lunas' ? 'Lunas' : 'Pending',
        });
        showStatus(`Kwitansi WA untuk ${order.orderId} berhasil dikirim ulang.`);
      } catch (err) {
        reportFirestoreFailure(
          err,
          OperationType.UPDATE,
          `orders/${order.orderId}`,
          'WA terkirim, namun gagal memperbarui status di database'
        );
      }
    } else {
      showStatus(`Gagal mengirim WA otomatis ke ${order.noWa}. Periksa token Fonnte.`, 'error');
    }
  };

  const handleTogglePaymentStatus = async (order: OrderRecord) => {
    const currentStatus: StatusPembayaran =
      order.statusPembayaran === 'Lunas' ? 'Lunas' : 'Pending';
    const nextStatus: StatusPembayaran = currentStatus === 'Lunas' ? 'Pending' : 'Lunas';

    try {
      await updateDoc(doc(db, 'orders', order.orderId), {
        statusPembayaran: nextStatus,
      });
      showStatus(
        `Status pembayaran ${order.orderId} (${order.namaSekolah}) diubah menjadi ${nextStatus}.`
      );
    } catch (err) {
      reportFirestoreFailure(
        err,
        OperationType.UPDATE,
        `orders/${order.orderId}`,
        'Gagal memperbarui status pembayaran'
      );
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setConfirmDeleteOrderId(null);
      showStatus(`Pesanan ${orderId} berhasil dihapus dari Firestore.`);
    } catch (err) {
      reportFirestoreFailure(
        err,
        OperationType.DELETE,
        `orders/${orderId}`,
        'Gagal menghapus pesanan'
      );
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = adminPinSetting.trim();
    const cleanToken = fonnteTokenInput.trim() || DEFAULT_FONNTE_TOKEN;

    if (!/^[a-zA-Z0-9]{4,32}$/.test(cleanPin)) {
      showStatus(
        'PIN Akses Panel Panitia harus terdiri dari 4 sampai 32 karakter huruf/angka tanpa spasi.',
        'error'
      );
      return;
    }

    if (cleanToken.length < 1 || cleanToken.length > 200) {
      showStatus('Token Fonnte harus 1 sampai 200 karakter.', 'error');
      return;
    }

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configJsonInput) as Record<string, unknown>;
      if (!parsedConfig.apiKey || !parsedConfig.projectId || !parsedConfig.appId) {
        showStatus('JSON firebaseConfig harus memiliki apiKey, projectId, dan appId.', 'error');
        return;
      }
    } catch {
      showStatus(
        'Format JSON firebaseConfig tidak valid. Periksa tanda kutip dan kurung kurawal.',
        'error'
      );
      return;
    }

    setConfigSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'panel'), {
        adminPin: cleanPin,
        fonnteToken: cleanToken,
        updatedAt: serverTimestamp(),
      });

      const currentSerialized = JSON.stringify(activeConfig);
      const nextSerialized = JSON.stringify(parsedConfig);
      if (currentSerialized !== nextSerialized) {
        localStorage.setItem(LS_FIREBASE_CONFIG_KEY, JSON.stringify(parsedConfig, null, 2));
        showStatus(
          'PIN & Token tersimpan di Cloud. Konfigurasi Firebase baru diterapkan, memuat ulang...'
        );
        setTimeout(() => window.location.reload(), 900);
      } else {
        showStatus(
          'PIN Akses Panel Panitia & Token Fonnte berhasil disimpan ke Cloud Firestore!'
        );
      }
    } catch (err) {
      reportFirestoreFailure(
        err,
        OperationType.WRITE,
        'settings/panel',
        'Gagal menyimpan konfigurasi ke Cloud'
      );
    } finally {
      setConfigSaving(false);
    }
  };

  const handleResetConfig = async () => {
    setConfigSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'panel'), {
        adminPin: DEFAULT_ADMIN_PIN,
        fonnteToken: DEFAULT_FONNTE_TOKEN,
        updatedAt: serverTimestamp(),
      });
      const hadCustom = isCustomFirebaseConfigActive;
      localStorage.removeItem(LS_FIREBASE_CONFIG_KEY);
      setConfigJsonInput(getDefaultConfigJson());
      setFonnteTokenInput(DEFAULT_FONNTE_TOKEN);
      setAdminPinSetting(DEFAULT_ADMIN_PIN);

      if (hadCustom) {
        showStatus('Konfigurasi direset ke default aplikasi. Halaman akan dimuat ulang...');
        setTimeout(() => window.location.reload(), 900);
      } else {
        showStatus('PIN Panitia & Token Fonnte berhasil direset ke pengaturan awal di Cloud Firestore.');
      }
    } catch (err) {
      reportFirestoreFailure(
        err,
        OperationType.WRITE,
        'settings/panel',
        'Gagal mereset konfigurasi di Cloud'
      );
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Panel Panitia Admin"
    >
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-[#0b1f3a] via-[#163a70] to-[#1e40af] px-5 py-4 text-white flex items-center justify-between border-b-3 border-amber-500">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base sm:text-lg font-extrabold">
                Panel Panitia &amp; Konfigurasi Sistem
              </h2>
              <p className="text-[11px] text-blue-100/80">
                Lomba Paskibra Garuda IV • SMKS PGRI 1 Sukabumi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition cursor-pointer"
            aria-label="Tutup panel panitia"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PIN Gate */}
        {!pinVerified ? (
          <form onSubmit={handleVerifyPin} className="p-6 sm:p-8 max-w-sm mx-auto w-full space-y-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Verifikasi PIN Panitia</h3>
              <p className="text-xs text-slate-500 mt-1">
                Masukkan PIN Panitia untuk mengakses rekap pesanan real-time, kelola menu, dan konfigurasi.
              </p>
            </div>
            <div>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Masukkan PIN Panitia"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 text-center tracking-widest font-bold"
                autoFocus
                required
              />
              {pinError && (
                <p className="text-xs text-red-600 font-semibold mt-1.5 text-center">{pinError}</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold rounded-lg transition cursor-pointer"
            >
              Masuk Panel Panitia
            </button>
          </form>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tabs Navigation */}
            <div className="px-5 pt-3 border-b border-slate-200 flex gap-2 overflow-x-auto bg-white">
              <button
                type="button"
                onClick={() => setActiveTab('orders')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'orders'
                    ? 'border-blue-700 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                Rekap Pesanan Real-Time
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('menus')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'menus'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <UtensilsCrossed className="w-4 h-4" />
                Kelola Paket Menu
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('config')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition whitespace-nowrap cursor-pointer ${
                  activeTab === 'config'
                    ? 'border-emerald-700 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Settings className="w-4 h-4" />
                Konfigurasi Sistem
              </button>
            </div>

            {/* Notification Banner */}
            {statusMessage && (
              <div
                className={`mx-5 mt-3 px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center justify-between gap-2 ${
                  statusType === 'error'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}
              >
                <span>{statusMessage}</span>
                <button
                  type="button"
                  onClick={() => setStatusMessage('')}
                  className={`${
                    statusType === 'error'
                      ? 'text-red-600 hover:text-red-900'
                      : 'text-blue-600 hover:text-blue-900'
                  } font-bold cursor-pointer`}
                >
                  ×
                </button>
              </div>
            )}

            {/* Tab Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* TAB 1: REKAP PESANAN */}
              {activeTab === 'orders' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-[11px] text-slate-600">
                    <span>
                      Terhubung ke Cloud Firestore:{' '}
                      <strong className="font-mono text-slate-800">{activeConfig.projectId}</strong>
                      {activeConfig.firestoreDatabaseId && (
                        <>
                          {' '}
                          • DB:{' '}
                          <strong className="font-mono text-slate-800">
                            {activeConfig.firestoreDatabaseId}
                          </strong>
                        </>
                      )}
                    </span>
                    <span className="font-semibold text-emerald-700">
                      Total tersimpan: {orders.length} pesanan
                    </span>
                  </div>

                  {ordersError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 font-semibold">
                      {ordersError}
                    </div>
                  )}

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-[#163a70]">
                        Total Pesanan Tampil
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 mt-1">
                        {summary.totalOrders} Kontingen
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {summary.lunasCount} Lunas • {summary.pendingCount} Pending
                      </div>
                    </div>
                    <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-amber-800">
                        Total Porsi Dipesan
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 mt-1">
                        {summary.totalPorsi.toLocaleString('id-ID')} Porsi
                      </div>
                      <div className="text-[11px] text-amber-800/80 mt-0.5">
                        Siap koordinasi dapur
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-emerald-700">
                        Total Pemasukan
                      </div>
                      <div className="text-xl font-extrabold text-emerald-700 mt-1">
                        Rp {summary.totalRevenue.toLocaleString('id-ID')}
                      </div>
                      <div className="text-[11px] text-emerald-700/85 mt-0.5">
                        Terverifikasi Lunas: Rp {summary.lunasRevenue.toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>

                  {/* Search & Filter Toolbar */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Cari sekolah, official, atau No. Pesanan..."
                          className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#163a70]"
                        />
                      </div>

                      <select
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(e.target.value as 'ALL' | 'Pending' | 'Lunas')
                        }
                        className="px-2.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none"
                        aria-label="Filter status pembayaran"
                      >
                        <option value="ALL">Semua Status</option>
                        <option value="Pending">Pending</option>
                        <option value="Lunas">Lunas</option>
                      </select>

                      <select
                        value={dateFilter}
                        onChange={(e) =>
                          setDateFilter(e.target.value as 'ALL' | 'Sabtu' | 'Minggu')
                        }
                        className="px-2.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none"
                        aria-label="Filter hari lomba"
                      >
                        <option value="ALL">Semua Hari</option>
                        <option value="Sabtu">Sabtu, 21 Nop</option>
                        <option value="Minggu">Minggu, 22 Nop</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleRefreshOrders()}
                        disabled={ordersLoading}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        title="Ambil data terbaru langsung dari Cloud Firestore"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${ordersLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportExcel()}
                        disabled={filteredOrders.length === 0 || exportingExcel}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {exportingExcel ? 'Menyiapkan Excel...' : 'Export Excel (.XLSX) Siap Cetak'}
                      </button>
                    </div>
                  </div>

                  {/* Active Filter Notice */}
                  {(searchQuery.trim() !== '' || statusFilter !== 'ALL' || dateFilter !== 'ALL') &&
                    orders.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                        <span>
                          Menampilkan <strong>{filteredOrders.length}</strong> dari{' '}
                          <strong>{orders.length}</strong> total pesanan (filter aktif).
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setStatusFilter('ALL');
                            setDateFilter('ALL');
                          }}
                          className="font-bold text-amber-800 underline hover:text-amber-950 cursor-pointer"
                        >
                          Reset Filter
                        </button>
                      </div>
                    )}

                  {/* Table */}
                  {ordersLoading ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      Memuat data pesanan dari Firestore...
                    </div>
                  ) : filteredOrders.length === 0 ? (
                    <div className="text-center py-8 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500 space-y-2">
                      <div>
                        {orders.length === 0
                          ? `Belum ada pesanan masuk pada database Firestore (${activeConfig.projectId}).`
                          : 'Tidak ada pesanan yang cocok dengan filter pencarian.'}
                      </div>
                      {orders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setStatusFilter('ALL');
                            setDateFilter('ALL');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold cursor-pointer"
                        >
                          Tampilkan Semua ({orders.length} Pesanan)
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                            <th className="p-2.5">Order ID &amp; Waktu</th>
                            <th className="p-2.5">Sekolah / Official</th>
                            <th className="p-2.5">Paket &amp; Porsi</th>
                            <th className="p-2.5">Jadwal Makan</th>
                            <th className="p-2.5">Total &amp; Status Bayar</th>
                            <th className="p-2.5">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredOrders.map((order) => {
                            const statusBayar: StatusPembayaran =
                              order.statusPembayaran === 'Lunas' ? 'Lunas' : 'Pending';
                            const isLunas = statusBayar === 'Lunas';

                            return (
                              <tr key={order.orderId} className="hover:bg-slate-50">
                                <td className="p-2.5 align-top">
                                  <div className="font-mono font-bold text-slate-900">
                                    {order.orderId}
                                  </div>
                                  <div className="text-[11px] text-slate-500">{order.waktu}</div>
                                  <span
                                    className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      order.waTerkirim
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {order.waTerkirim ? 'WA Terkirim' : 'WA Pending'}
                                  </span>
                                </td>
                                <td className="p-2.5 align-top">
                                  <div className="font-bold text-slate-900">{order.namaSekolah}</div>
                                  <div className="text-slate-600">{order.namaPj}</div>
                                  <div className="font-mono text-[11px] text-blue-700">
                                    {order.noWa}
                                  </div>
                                </td>
                                <td className="p-2.5 align-top">
                                  <div className="font-semibold text-slate-800">
                                    {order.namaPaket}
                                  </div>
                                  <div className="text-slate-600">
                                    {order.jumlahPorsi} porsi × Rp{' '}
                                    {Number(order.hargaSatuan).toLocaleString('id-ID')}
                                  </div>
                                  {order.catatan && order.catatan !== '-' && (
                                    <div className="text-[11px] text-slate-500 italic mt-0.5">
                                      Catatan: {order.catatan}
                                    </div>
                                  )}
                                </td>
                                <td className="p-2.5 align-top text-slate-700">
                                  <div>{order.tanggalMakan}</div>
                                  <div className="font-semibold">
                                    {order.sesiMakan} ({order.jamMakan} WIB)
                                  </div>
                                </td>
                                <td className="p-2.5 align-top whitespace-nowrap">
                                  <div className="font-extrabold text-emerald-700">
                                    Rp {Number(order.totalHarga).toLocaleString('id-ID')}
                                  </div>
                                  <span
                                    className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${
                                      isLunas
                                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                        : 'bg-amber-100 text-amber-800 border-amber-300'
                                    }`}
                                  >
                                    {isLunas ? (
                                      <CheckCircle2 className="w-3 h-3" />
                                    ) : (
                                      <Clock className="w-3 h-3" />
                                    )}
                                    {statusBayar}
                                  </span>
                                </td>
                                <td className="p-2.5 align-top">
                                  <div className="flex flex-col gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void handleTogglePaymentStatus(order)}
                                      className={`inline-flex items-center gap-1 px-2 py-1 rounded font-semibold cursor-pointer ${
                                        isLunas
                                          ? 'bg-amber-50 hover:bg-amber-100 text-amber-800'
                                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      }`}
                                    >
                                      {isLunas ? (
                                        <>
                                          <Clock className="w-3.5 h-3.5" />
                                          Set Pending
                                        </>
                                      ) : (
                                        <>
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          Tandai Lunas
                                        </>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPreviewProofOrder(order)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold cursor-pointer"
                                    >
                                      <ImageIcon className="w-3.5 h-3.5" />
                                      Bukti Bayar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleResendWa(order)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold cursor-pointer"
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                      Kirim WA
                                    </button>
                                    {confirmDeleteOrderId === order.orderId ? (
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => void handleDeleteOrder(order.orderId)}
                                          className="flex-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
                                        >
                                          Ya, Hapus
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteOrderId(null)}
                                          className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold cursor-pointer"
                                        >
                                          Batal
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteOrderId(order.orderId)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-semibold cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Hapus
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: KELOLA PAKET MENU */}
              {activeTab === 'menus' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3.5">
                    <div className="text-xs text-orange-900">
                      <span className="font-bold">Status Katalog Firestore:</span>{' '}
                      {hasFirestoreMenus
                        ? `${menus.length} paket menu aktif tersimpan di Firestore.`
                        : 'Koleksi menus di Firestore masih kosong (saat ini menampilkan menu contoh bawaan).'}
                    </div>
                    <button
                      type="button"
                      onClick={handleManualSeedMenus}
                      disabled={seedingMenus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {seedingMenus ? 'Menyimpan...' : 'Muat Paket Contoh (Auto-Seed)'}
                    </button>
                  </div>

                  {/* Form Tambah / Edit Menu */}
                  <form
                    onSubmit={handleSaveMenu}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                  >
                    <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
                      Tambah / Perbarui Paket Menu
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          ID Paket (unik, tanpa spasi)
                        </label>
                        <input
                          type="text"
                          value={menuId}
                          onChange={(e) => setMenuId(e.target.value)}
                          placeholder="Contoh: PKT-05"
                          maxLength={32}
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Nama Paket Menu
                        </label>
                        <input
                          type="text"
                          value={menuNama}
                          onChange={(e) => setMenuNama(e.target.value)}
                          placeholder="Contoh: Paket Nasi Kotak Ikan Bakar"
                          maxLength={150}
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Harga Satuan (Rp)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10000000}
                          value={menuHarga}
                          onChange={(e) => setMenuHarga(e.target.value)}
                          placeholder="25000"
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Urutan Tampil
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          value={menuUrutan}
                          onChange={(e) => setMenuUrutan(e.target.value)}
                          placeholder="1"
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        URL Foto Menu (Google Drive / URL Gambar Publik)
                      </label>
                      <input
                        type="text"
                        value={menuGambar}
                        onChange={(e) => setMenuGambar(e.target.value)}
                        maxLength={1000}
                        placeholder="https://drive.google.com/file/d/... atau https://..."
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={menuSaving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      {menuSaving ? 'Menyimpan...' : 'Simpan Paket Menu'}
                    </button>
                  </form>

                  {/* Daftar Menu Saat Ini */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
                      Daftar Menu Terdaftar ({menus.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {menus.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 bg-white"
                        >
                          <img
                            src={bersihkanUrlGambar(m.gambar)}
                            alt={m.nama}
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_IMAGE_SVG;
                            }}
                            className="w-16 h-16 rounded-lg object-cover bg-slate-100 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-mono text-slate-500">
                              {m.id} • Urutan #{m.urutan}
                            </div>
                            <div className="text-xs font-bold text-slate-900 truncate">{m.nama}</div>
                            <div className="text-xs font-extrabold text-orange-600">
                              Rp {Number(m.harga).toLocaleString('id-ID')}
                            </div>
                            <div className="flex gap-2 mt-1.5">
                              <button
                                type="button"
                                onClick={() => handleEditMenuClick(m)}
                                className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                              >
                                Edit
                              </button>
                              {hasFirestoreMenus &&
                                (confirmDeleteMenuId === m.id ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteMenu(m.id)}
                                      className="text-[11px] font-bold text-red-700 hover:underline cursor-pointer"
                                    >
                                      Konfirmasi Hapus
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteMenuId(null)}
                                      className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer"
                                    >
                                      Batal
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteMenuId(m.id)}
                                    className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                                  >
                                    Hapus
                                  </button>
                                ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: KONFIGURASI SISTEM */}
              {activeTab === 'config' && (
                <form onSubmit={handleSaveConfig} className="space-y-4">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
                    <div>
                      <span className="font-bold">Sumber Konfigurasi Firebase:</span>{' '}
                      {isCustomFirebaseConfigActive
                        ? 'Custom School Config (tersimpan di localStorage)'
                        : `Project Firebase Terprovisi (${activeConfig.projectId})`}
                    </div>
                    <div>
                      <span className="font-bold">Status Sinkronisasi PIN &amp; Token:</span>{' '}
                      {settingsLoadedFromCloud ? (
                        <span className="text-emerald-700 font-bold">
                          ✓ Tersimpan &amp; Sinkron di Cloud Firestore (settings/panel)
                        </span>
                      ) : (
                        <span className="text-amber-700 font-semibold">
                          Menunggu sinkronisasi Cloud Firestore...
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        PIN Akses Panel Panitia (Tersimpan di Cloud Firestore)
                      </label>
                      <input
                        type="text"
                        value={adminPinSetting}
                        onChange={(e) => setAdminPinSetting(e.target.value)}
                        placeholder="Minimal 4 karakter (huruf/angka)"
                        maxLength={32}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        FONNTE_TOKEN (Tersimpan di Cloud Firestore)
                      </label>
                      <input
                        type="text"
                        value={fonnteTokenInput}
                        onChange={(e) => setFonnteTokenInput(e.target.value)}
                        maxLength={200}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      JSON firebaseConfig (Opsional untuk pindah ke Project Firebase Sekolah)
                    </label>
                    <textarea
                      rows={8}
                      value={configJsonInput}
                      onChange={(e) => setConfigJsonInput(e.target.value)}
                      className="w-full p-3 font-mono text-xs bg-slate-900 text-emerald-300 rounded-xl border border-slate-700 focus:outline-none"
                      required
                    />
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    <button
                      type="submit"
                      disabled={configSaving}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      {configSaving ? 'Menyimpan ke Cloud...' : 'Simpan Konfigurasi ke Cloud'}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetConfig}
                      disabled={configSaving}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Reset ke Default
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox Pratinjau Bukti Pembayaran */}
      {previewProofOrder && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setPreviewProofOrder(null)}
        >
          <div
            className="max-w-lg w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between text-xs font-bold">
              <span>
                Bukti Transfer • {previewProofOrder.orderId} ({previewProofOrder.namaSekolah})
              </span>
              <button
                type="button"
                onClick={() => setPreviewProofOrder(null)}
                className="text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 flex flex-col items-center gap-3">
              <img
                src={previewProofOrder.fileUrl}
                alt={`Bukti bayar ${previewProofOrder.orderId}`}
                className="max-h-[65vh] w-auto rounded-lg shadow border border-slate-300 object-contain"
              />
              {!previewProofOrder.fileUrl.startsWith('data:') && (
                <a
                  href={previewProofOrder.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka URL Asli Firebase Storage
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
