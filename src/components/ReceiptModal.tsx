import React, { useState } from 'react';
import { CheckCircle2, Copy, Printer, MessageCircle, X, Download } from 'lucide-react';
import type { OrderRecord } from '../types/catering';
import { buatTeksKwitansi } from '../utils/cateringHelpers';

interface ReceiptModalProps {
  order: OrderRecord | null;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ order, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!order) return null;

  const receiptText = buatTeksKwitansi({
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

  const waShareUrl = `https://wa.me/${order.noWa}?text=${encodeURIComponent(receiptText)}`;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = receiptText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([receiptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kwitansi_${order.orderId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receiptModalTitle"
    >
      <div
        id="printableReceiptArea"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto"
      >
        {/* Header Kwitansi */}
        <div className="bg-gradient-to-r from-[#091e3a] via-[#103774] to-[#1e40af] px-5 py-4 text-white border-b-3 border-amber-500 flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              PESANAN DITERIMA PANITIA
            </div>
            <h2 id="receiptModalTitle" className="text-lg font-extrabold tracking-tight">
              Kwitansi Digital Resmi
            </h2>
            <p className="text-xs text-blue-100/85">
              Lomba Paskibra Garuda IV • SMKS PGRI 1 Sukabumi
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="no-print p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition cursor-pointer"
            aria-label="Tutup kwitansi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Status WhatsApp */}
          <div
            className={`no-print rounded-xl px-3.5 py-2.5 text-xs font-semibold border flex items-center justify-between gap-2 ${
              order.waTerkirim
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <span>
              {order.waTerkirim
                ? `✓ Kwitansi otomatis terkirim ke WhatsApp (${order.noWa})`
                : `ℹ️ Data tersimpan. Klik tombol WhatsApp di bawah untuk kirim salinan ke ${order.noWa}`}
            </span>
          </div>

          {/* Detail Kwitansi */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-dashed border-slate-300">
              <span className="text-slate-500 font-medium">No. Pesanan</span>
              <span className="font-mono font-extrabold text-slate-900">{order.orderId}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Waktu Pesan</span>
              <span className="font-semibold text-slate-800 text-right">{order.waktu} WIB</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Sekolah</span>
              <span className="font-bold text-slate-900 text-right">{order.namaSekolah}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Nama Official</span>
              <span className="font-semibold text-slate-800 text-right">{order.namaPj}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Paket Menu</span>
              <span className="font-semibold text-slate-800 text-right">{order.namaPaket}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Jumlah Porsi</span>
              <span className="font-semibold text-slate-800 text-right">
                {order.jumlahPorsi} Porsi (Rp {Number(order.hargaSatuan).toLocaleString('id-ID')}/porsi)
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Jadwal Makan</span>
              <span className="font-semibold text-slate-800 text-right">{order.jadwalMakan}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Catatan</span>
              <span className="font-medium text-slate-700 text-right">{order.catatan || '-'}</span>
            </div>

            <div className="pt-2.5 mt-1 border-t border-dashed border-slate-300 flex justify-between items-center">
              <span className="font-extrabold text-slate-900 text-sm">TOTAL BAYAR</span>
              <span className="text-base font-extrabold text-emerald-700">
                Rp {Number(order.totalHarga).toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-center text-slate-500">
            Simpan kwitansi ini sebagai bukti pemesanan yang sah saat pengambilan konsumsi di stand panitia.
          </p>

          {/* Action Buttons */}
          <div className="no-print grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Unduh / Cetak Kwitansi
            </button>

            <a
              href={waShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition no-underline"
            >
              <MessageCircle className="w-4 h-4" />
              Kirim Salinan ke WhatsApp
            </a>

            <button
              type="button"
              onClick={handleCopyText}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Teks Disalin!' : 'Salin Teks Kwitansi'}
            </button>

            <button
              type="button"
              onClick={handleDownloadTxt}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Simpan File .TXT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
