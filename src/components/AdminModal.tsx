import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  ClipboardList,
  Download,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
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
import type { MenuItem, OrderRecord } from '../types/catering';
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

  useEffect(() => {
    setFonnteTokenInput(cloudFonnteToken);
  }, [cloudFonnteToken]);

  useEffect(() => {
    setAdminPinSetting(cloudAdminPin);
  }, [cloudAdminPin]);

  // Reset error saat modal ditutup
  useEffect(() => {
    if (!isOpen) {
      setPinError('');
      setStatusMessage('');
    }
  }, [isOpen]);

  // Real-time listener orders langsung aktif setelah PIN terverifikasi (tanpa login Google)
  useEffect(() => {
    if (!isOpen || !pinVerified) {
      return;
    }

    setOrdersLoading(true);
    setOrdersError('');
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: OrderRecord[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as OrderRecord);
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

  const summary = useMemo(() => {
    return orders.reduce(
      (acc, o) => {
        acc.totalOrders += 1;
        acc.totalPorsi += Number(o.jumlahPorsi || 0);
        acc.totalRevenue += Number(o.totalHarga || 0);
        return acc;
      },
      { totalOrders: 0, totalPorsi: 0, totalRevenue: 0 }
    );
  }, [orders]);

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
      setStatusMessage('Paket menu contoh berhasil dimuat ke koleksi menus Firestore.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'menus');
    } finally {
      setSeedingMenus(false);
    }
  };

  const handleSaveMenu = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanId = menuId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanNama = menuNama.trim();
    const numHarga = Number(menuHarga);
    const numUrutan = Number(menuUrutan || 1);

    if (!cleanId || !cleanNama || !Number.isFinite(numHarga) || numHarga <= 0) {
      setStatusMessage('ID Paket, Nama Paket, dan Harga valid wajib diisi.');
      return;
    }

    setMenuSaving(true);
    try {
      await setDoc(doc(db, 'menus', cleanId), {
        id: cleanId,
        nama: cleanNama,
        harga: numHarga,
        gambar: menuGambar.trim(),
        urutan: Number.isFinite(numUrutan) && numUrutan >= 0 ? numUrutan : 1,
      });
      setMenuId('');
      setMenuNama('');
      setMenuHarga('');
      setMenuGambar('');
      setMenuUrutan(String(menus.length + 2));
      setStatusMessage(`Paket menu "${cleanNama}" (${cleanId}) berhasil disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `menus/${cleanId}`);
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
      setStatusMessage(`Paket menu ${id} berhasil dihapus.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `menus/${id}`);
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
        await setDoc(
          doc(db, 'orders', order.orderId),
          { ...order, waTerkirim: true },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `orders/${order.orderId}`);
      }
      setStatusMessage(`Kwitansi WA untuk ${order.orderId} berhasil dikirim ulang.`);
    } else {
      setStatusMessage(`Gagal mengirim WA otomatis ke ${order.noWa}. Periksa token Fonnte.`);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setStatusMessage(`Pesanan ${orderId} berhasil dihapus.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = adminPinSetting.trim();
    const cleanToken = fonnteTokenInput.trim() || DEFAULT_FONNTE_TOKEN;

    if (!/^[a-zA-Z0-9]{4,32}$/.test(cleanPin)) {
      setStatusMessage(
        'PIN Akses Panel Panitia harus terdiri dari 4 sampai 32 karakter huruf/angka tanpa spasi.'
      );
      return;
    }

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configJsonInput) as Record<string, unknown>;
      if (!parsedConfig.apiKey || !parsedConfig.projectId || !parsedConfig.appId) {
        setStatusMessage('JSON firebaseConfig harus memiliki apiKey, projectId, dan appId.');
        return;
      }
    } catch {
      setStatusMessage(
        'Format JSON firebaseConfig tidak valid. Periksa tanda kutip dan kurung kurawal.'
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
        setStatusMessage(
          'PIN & Token tersimpan di Cloud. Konfigurasi Firebase baru diterapkan, memuat ulang...'
        );
        setTimeout(() => window.location.reload(), 900);
      } else {
        setStatusMessage(
          'PIN Akses Panel Panitia & Token Fonnte berhasil disimpan ke Cloud Firestore!'
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/panel');
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
        setStatusMessage('Konfigurasi direset ke default aplikasi. Halaman akan dimuat ulang...');
        setTimeout(() => window.location.reload(), 900);
      } else {
        setStatusMessage('PIN Panitia (1234) & Token Fonnte berhasil direset di Cloud Firestore.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/panel');
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
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-[#091e3a] via-[#103774] to-[#1e40af] px-5 py-4 text-white flex items-center justify-between border-b-3 border-amber-500">
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
                placeholder="Masukkan PIN (default: 1234)"
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
              <div className="mx-5 mt-3 px-3.5 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold flex items-center justify-between">
                <span>{statusMessage}</span>
                <button
                  type="button"
                  onClick={() => setStatusMessage('')}
                  className="text-blue-600 hover:text-blue-900 font-bold cursor-pointer"
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
                  {ordersError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 font-semibold">
                      {ordersError}
                    </div>
                  )}

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-blue-700">
                        Total Pesanan Masuk
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 mt-1">
                        {summary.totalOrders} Kontingen
                      </div>
                    </div>
                    <div className="rounded-xl bg-orange-50 border border-orange-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-orange-700">
                        Total Porsi Dipesan
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 mt-1">
                        {summary.totalPorsi.toLocaleString('id-ID')} Porsi
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
                      <div className="text-[11px] font-bold uppercase text-emerald-700">
                        Total Pemasukan
                      </div>
                      <div className="text-xl font-extrabold text-emerald-700 mt-1">
                        Rp {summary.totalRevenue.toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>

                  {/* Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-slate-800">
                      Daftar Pesanan Masuk ({orders.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => void exportOrdersToExcel(orders)}
                      disabled={orders.length === 0}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Excel (.XLSX) Siap Cetak
                    </button>
                  </div>

                  {/* Table */}
                  {ordersLoading ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      Memuat data pesanan dari Firestore...
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="text-center py-8 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
                      Belum ada pesanan masuk pada database Firestore.
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
                            <th className="p-2.5">Total Bayar</th>
                            <th className="p-2.5">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {orders.map((order) => (
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
                                <div className="font-mono text-[11px] text-blue-700">{order.noWa}</div>
                              </td>
                              <td className="p-2.5 align-top">
                                <div className="font-semibold text-slate-800">{order.namaPaket}</div>
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
                              <td className="p-2.5 align-top font-extrabold text-emerald-700 whitespace-nowrap">
                                Rp {Number(order.totalHarga).toLocaleString('id-ID')}
                              </td>
                              <td className="p-2.5 align-top">
                                <div className="flex flex-col gap-1.5">
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
                                    onClick={() => handleResendWa(order)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold cursor-pointer"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                    Kirim WA
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteOrder(order.orderId)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-semibold cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Hapus
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
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
                          min="1000"
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
                          min="0"
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
                              {hasFirestoreMenus && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMenu(m.id)}
                                  className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                                >
                                  Hapus
                                </button>
                              )}
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
