export interface MenuItem {
  id: string;
  nama: string;
  harga: number;
  gambar: string;
  urutan: number;
}

export type TanggalMakan = 'Sabtu, 21 Nop 2026' | 'Minggu, 22 Nop 2026';
export type SesiMakan = 'Makan Pagi' | 'Makan Siang' | 'Makan Sore/Malam';
export type StatusPembayaran = 'Pending' | 'Lunas';

export interface OrderPayload {
  namaSekolah: string;
  namaPj: string;
  noWa: string;
  namaPaket: string;
  hargaSatuan: number;
  jumlahPorsi: number;
  tanggalMakan: TanggalMakan;
  sesiMakan: SesiMakan;
  jamMakan: string;
  totalHarga: number;
  catatan: string;
}

export interface OrderRecord {
  waktu: string;
  createdAt?: unknown;
  orderId: string;
  namaSekolah: string;
  namaPj: string;
  noWa: string;
  namaPaket: string;
  hargaSatuan: number;
  jumlahPorsi: number;
  tanggalMakan: string;
  sesiMakan: string;
  jamMakan: string;
  jadwalMakan: string;
  totalHarga: number;
  fileUrl: string;
  catatan: string;
  waTerkirim: boolean;
  statusPembayaran: StatusPembayaran;
}

export interface FirebaseCustomConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
}

export interface PanelSettings {
  adminPin: string;
  fonnteToken: string;
  updatedAt?: unknown;
}
