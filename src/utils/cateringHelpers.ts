import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import type { MenuItem } from '../types/catering';

export const DEFAULT_FONNTE_TOKEN = 'dcEHH47Mo9Zq5ZeFjjnu';
export const DEFAULT_ADMIN_PIN = '1234';

export const FALLBACK_IMAGE_SVG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='240' viewBox='0 0 400 240'%3E%3Crect width='400' height='240' fill='%23fff7ed'/%3E%3Crect x='140' y='60' width='120' height='80' rx='12' fill='%23fed7aa'/%3E%3Ccircle cx='200' cy='100' r='22' fill='%23ea580c' opacity='0.85'/%3E%3Ctext x='200' y='175' text-anchor='middle' font-family='Inter,Arial,sans-serif' font-size='14' font-weight='700' fill='%239a3412'%3EMenu Katering Garuda IV%3C/text%3E%3C/svg%3E";

export const DEFAULT_MENUS: MenuItem[] = [
  {
    id: 'PKT-01',
    nama: 'Paket Nasi Kotak Ayam Bakar',
    harga: 25000,
    gambar: '/src/assets/images/paket_ayam_bakar_1794915727545.jpg',
    urutan: 1,
  },
  {
    id: 'PKT-02',
    nama: 'Paket Nasi Kotak Ayam Goreng Lengkuas',
    harga: 24000,
    gambar: '/src/assets/images/paket_ayam_lengkuas_1794915727947.jpg',
    urutan: 2,
  },
  {
    id: 'PKT-03',
    nama: 'Paket Nasi Kotak Rendang Komplit',
    harga: 30000,
    gambar: '/src/assets/images/paket_rendang_komplit_1794915727715.jpg',
    urutan: 3,
  },
  {
    id: 'PKT-04',
    nama: 'Paket Snack Box + Air Mineral',
    harga: 12000,
    gambar: '/src/assets/images/paket_snack_mineral_1794915728381.jpg',
    urutan: 4,
  },
];

export function bersihkanUrlGambar(rawUrl: string | undefined | null): string {
  if (!rawUrl || !rawUrl.trim()) {
    return FALLBACK_IMAGE_SVG;
  }

  let clean = rawUrl.trim();
  const mdMatch = clean.match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
  if (mdMatch && mdMatch[1]) {
    clean = mdMatch[1].trim();
  }

  const driveFileMatch = clean.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFileMatch && driveFileMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${driveFileMatch[1]}&sz=w600`;
  }

  const driveIdMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1] && clean.includes('drive.google.com')) {
    return `https://drive.google.com/thumbnail?id=${driveIdMatch[1]}&sz=w600`;
  }

  return clean;
}

export function standarisasiNomorWA(nomor: string): string {
  const cleaned = String(nomor || '').replace(/[^0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('0')) {
    return '62' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('62')) {
    return '62' + cleaned;
  }
  return cleaned;
}

export function formatWaktuJakarta(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${getPart('day')}/${getPart('month')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

export function generateOrderId(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const suffixChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 3; i++) {
    suffix += suffixChars.charAt(Math.floor(Math.random() * suffixChars.length));
  }
  return `ORD-${getPart('year')}${getPart('month')}${getPart('day')}-${getPart('hour')}${getPart('minute')}${getPart('second')}-${suffix}`;
}

export function compressImageToDataUrl(
  file: File,
  maxDimension = 900,
  initialQuality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.max(1, Math.round((height * maxDimension) / width));
            width = maxDimension;
          } else {
            width = Math.max(1, Math.round((width * maxDimension) / height));
            height = maxDimension;
          }
        }

        const renderAtSize = (w: number, h: number, quality: number): string => {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas context tidak tersedia.');
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', quality);
        };

        try {
          let quality = initialQuality;
          let dataUrl = renderAtSize(width, height, quality);

          while (dataUrl.length > 650000 && quality > 0.25) {
            quality = Math.max(0.25, quality - 0.12);
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          let scaleAttempts = 0;
          while (dataUrl.length > 650000 && scaleAttempts < 4) {
            width = Math.max(200, Math.round(width * 0.72));
            height = Math.max(200, Math.round(height * 0.72));
            dataUrl = renderAtSize(width, height, 0.55);
            scaleAttempts += 1;
          }

          if (dataUrl.length > 740000) {
            reject(new Error('Ukuran gambar terlalu besar setelah dikompresi. Gunakan foto yang lebih kecil.'));
            return;
          }

          resolve(dataUrl);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Gagal memproses gambar.'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadBuktiBayar(
  orderId: string,
  file: File
): Promise<{ fileUrl: string; storageMode: 'firebase-storage' | 'base64-fallback' }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `bukti_bayar/${orderId}_${safeName}`);

  try {
    const uploadPromise = (async () => {
      const snapshot = await uploadBytes(storageRef, file, {
        contentType: file.type || 'image/jpeg',
      });
      return await getDownloadURL(snapshot.ref);
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Storage upload timeout')), 4000);
    });

    const downloadUrl = await Promise.race([uploadPromise, timeoutPromise]);
    return { fileUrl: downloadUrl, storageMode: 'firebase-storage' };
  } catch (storageErr) {
    console.warn(
      'Firebase Storage belum aktif/gagal, beralih ke kompresi Base64 Data URL di Firestore:',
      storageErr
    );
    const compressedUrl = await compressImageToDataUrl(file);
    return { fileUrl: compressedUrl, storageMode: 'base64-fallback' };
  }
}

export function buatTeksKwitansi(data: {
  orderId: string;
  namaSekolah: string;
  namaPj: string;
  namaPaket: string;
  jumlahPorsi: number;
  jadwalMakan: string;
  hargaSatuan: number;
  totalHarga: number;
  catatan?: string;
}): string {
  return `*BUKTI KWITANSI PEMESANAN KATERING*
*GARUDA IV - SMKS PGRI 1 SUKABUMI*
----------------------------------------
No. Pesanan  : ${data.orderId}
Sekolah      : ${data.namaSekolah}
Nama Official: ${data.namaPj}
Paket Menu   : ${data.namaPaket}
Jumlah Porsi : ${data.jumlahPorsi} Porsi
Jadwal Makan : ${data.jadwalMakan}
Harga Satuan : Rp ${Number(data.hargaSatuan).toLocaleString('id-ID')}
----------------------------------------
*TOTAL BAYAR : Rp ${Number(data.totalHarga).toLocaleString('id-ID')}*
Catatan      : ${data.catatan || '-'}
----------------------------------------
Status: Pesanan telah diterima panitia.
Simpan pesan ini sebagai bukti pemesanan yang sah. Terima kasih!`;
}

export async function kirimPesanWhatsAppOtomatis(
  nomorTujuan: string,
  isiPesan: string,
  tokenOverride?: string
): Promise<boolean> {
  const tokenBersih = (tokenOverride || DEFAULT_FONNTE_TOKEN).trim();
  const nomorStandar = standarisasiNomorWA(nomorTujuan);

  if (!tokenBersih || !nomorStandar) {
    return false;
  }

  const formData = new FormData();
  formData.append('target', nomorStandar);
  formData.append('message', isiPesan);
  formData.append('countryCode', '62');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        Authorization: tokenBersih,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as { status?: boolean };
    return Boolean(result?.status);
  } catch (err) {
    console.warn('Pengiriman Fonnte gagal atau diblokir jaringan:', err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
