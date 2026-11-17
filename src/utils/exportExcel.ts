import ExcelJS from 'exceljs';
import type { OrderRecord } from '../types/catering';
import { formatWaktuJakarta } from './cateringHelpers';

function estimateRowHeight(values: (string | number)[], colWidths: number[]): number {
  let maxLines = 1;
  values.forEach((val, idx) => {
    const text = String(val ?? '');
    if (!text) return;
    const width = Math.max(8, colWidths[idx] - 2);
    const segments = text.split('\n');
    let lines = 0;
    for (const seg of segments) {
      lines += Math.max(1, Math.ceil(seg.length / width));
    }
    if (lines > maxLines) maxLines = lines;
  });
  return Math.max(22, maxLines * 15 + 8);
}

export async function exportOrdersToExcel(orders: OrderRecord[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panitia Katering Garuda IV - SMKS PGRI 1 Sukabumi';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Rekap Pesanan', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.35,
        right: 0.35,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
      },
      printTitlesRow: '5:5',
    },
  });

  const colWidths = [5, 25, 18, 25, 20, 16, 26, 15, 9, 17, 29, 26];
  sheet.columns = colWidths.map((width) => ({ width }));

  const totalPorsi = orders.reduce((acc, o) => acc + Number(o.jumlahPorsi || 0), 0);
  const totalRevenue = orders.reduce((acc, o) => acc + Number(o.totalHarga || 0), 0);
  const printedAt = formatWaktuJakarta(new Date());

  // Row 1: Main Title
  sheet.mergeCells('A1:L1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'REKAPITULASI PEMESANAN KATERING';
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF091E3A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  // Row 2: Event Subtitle
  sheet.mergeCells('A2:L2');
  const subCell = sheet.getCell('A2');
  subCell.value = 'LOMBA PASKIBRA GARUDA IV • SMKS PGRI 1 SUKABUMI';
  subCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF103774' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  subCell.border = { bottom: { style: 'medium', color: { argb: 'FFF59E0B' } } };
  sheet.getRow(2).height = 22;

  // Row 3: Print Metadata & Quick Summary
  sheet.mergeCells('A3:L3');
  const metaCell = sheet.getCell('A3');
  metaCell.value = `Dicetak: ${printedAt} WIB   |   Total Kontingen: ${orders.length}   |   Total Porsi: ${totalPorsi.toLocaleString('id-ID')}   |   Total Pemasukan: Rp ${totalRevenue.toLocaleString('id-ID')}`;
  metaCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF334155' } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  metaCell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  sheet.getRow(3).height = 20;

  // Row 4: Spacer
  sheet.getRow(4).height = 8;

  // Row 5: Table Header
  const headers = [
    'No',
    'No. Pesanan',
    'Waktu Pesan',
    'Sekolah / Kontingen',
    'Nama Official / PJ',
    'No. WhatsApp',
    'Paket Menu',
    'Harga Satuan',
    'Porsi',
    'Total Bayar',
    'Jadwal Pengantaran',
    'Status Bayar, WA & Catatan',
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headers;
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF3B82F6' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FF3B82F6' } },
    };
  });

  // Data Rows
  const startDataRow = 6;
  orders.forEach((o, index) => {
    const rowNumber = startDataRow + index;
    const statusWa = o.waTerkirim ? 'WA Terkirim' : 'WA Pending';
    const statusBayar = o.statusPembayaran === 'Lunas' ? 'Lunas' : 'Pending';
    const catatanGabung =
      o.catatan && o.catatan !== '-'
        ? `${o.catatan}\n(${statusBayar} | ${statusWa})`
        : `(${statusBayar} | ${statusWa})`;

    const rowValues: (string | number)[] = [
      index + 1,
      o.orderId || '-',
      `${o.waktu || '-'} WIB`,
      o.namaSekolah || '-',
      o.namaPj || '-',
      String(o.noWa || '-'),
      o.namaPaket || '-',
      Number(o.hargaSatuan || 0),
      Number(o.jumlahPorsi || 0),
      Number(o.totalHarga || 0),
      o.jadwalMakan || '-',
      catatanGabung,
    ];

    const row = sheet.getRow(rowNumber);
    row.values = rowValues;
    row.height = estimateRowHeight(rowValues, colWidths);

    const isEven = index % 2 === 1;
    const rowFill = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

    row.eachCell((cell, colNumber) => {
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: colNumber === 10,
        color: { argb: colNumber === 10 ? 'FF15803D' : 'FF0F172A' },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };

      if ([1, 2, 3, 6, 9].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      } else if ([8, 10].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
        cell.numFmt = '"Rp "#,##0';
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }

      if (colNumber === 6) {
        cell.numFmt = '@';
      }
      if (colNumber === 9) {
        cell.numFmt = '#,##0';
      }
    });
  });

  // Total Footer Row
  const lastDataRow = orders.length > 0 ? startDataRow + orders.length - 1 : startDataRow;
  const totalRowNum = orders.length > 0 ? lastDataRow + 1 : startDataRow;

  if (orders.length > 0) {
    sheet.mergeCells(`A${totalRowNum}:H${totalRowNum}`);
    sheet.mergeCells(`K${totalRowNum}:L${totalRowNum}`);

    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 26;

    const labelCell = sheet.getCell(`A${totalRowNum}`);
    labelCell.value = 'TOTAL KESELURUHAN';
    labelCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const porsiTotalCell = sheet.getCell(`I${totalRowNum}`);
    porsiTotalCell.value = { formula: `SUM(I${startDataRow}:I${lastDataRow})` };
    porsiTotalCell.numFmt = '#,##0';
    porsiTotalCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const bayarTotalCell = sheet.getCell(`J${totalRowNum}`);
    bayarTotalCell.value = { formula: `SUM(J${startDataRow}:J${lastDataRow})` };
    bayarTotalCell.numFmt = '"Rp "#,##0';
    bayarTotalCell.alignment = { vertical: 'middle', horizontal: 'right' };

    for (let col = 1; col <= 12; col++) {
      const c = totalRow.getCell(col);
      c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF14532D' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      c.border = {
        top: { style: 'medium', color: { argb: 'FF16A34A' } },
        bottom: { style: 'double', color: { argb: 'FF16A34A' } },
        left: { style: 'thin', color: { argb: 'FF86EFAC' } },
        right: { style: 'thin', color: { argb: 'FF86EFAC' } },
      };
    }
  }

  // Signature Block
  const sigStart = totalRowNum + 2;
  sheet.mergeCells(`J${sigStart}:L${sigStart}`);
  const sigDate = sheet.getCell(`J${sigStart}`);
  sigDate.value = `Sukabumi, ${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())}`;
  sigDate.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
  sigDate.alignment = { horizontal: 'center' };

  sheet.mergeCells(`J${sigStart + 1}:L${sigStart + 1}`);
  const sigRole = sheet.getCell(`J${sigStart + 1}`);
  sigRole.value = 'Panitia Konsumsi Garuda IV';
  sigRole.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  sigRole.alignment = { horizontal: 'center' };

  sheet.mergeCells(`J${sigStart + 5}:L${sigStart + 5}`);
  const sigLine = sheet.getCell(`J${sigStart + 5}`);
  sigLine.value = '( ___________________________ )';
  sigLine.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  sigLine.alignment = { horizontal: 'center' };

  // =========================================================================
  // Worksheet 2: Ringkasan Dapur & Jadwal (untuk koordinasi konsumsi)
  // =========================================================================
  const summarySheet = workbook.addWorksheet('Ringkasan Dapur & Jadwal', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  summarySheet.columns = [{ width: 36 }, { width: 18 }, { width: 16 }, { width: 22 }];

  summarySheet.mergeCells('A1:D1');
  const sTitle = summarySheet.getCell('A1');
  sTitle.value = 'RINGKASAN KEBUTUHAN DAPUR & JADWAL ANTAR';
  sTitle.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  sTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF091E3A' } };
  sTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(1).height = 26;

  summarySheet.mergeCells('A2:D2');
  const sSub = summarySheet.getCell('A2');
  sSub.value = 'GARUDA IV • SMKS PGRI 1 SUKABUMI';
  sSub.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  sSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF103774' } };
  sSub.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(2).height = 20;

  // Group by Paket Menu
  const byMenu = new Map<string, { count: number; porsi: number; total: number }>();
  const bySchedule = new Map<string, { count: number; porsi: number }>();

  for (const o of orders) {
    const mKey = o.namaPaket;
    const prevM = byMenu.get(mKey) || { count: 0, porsi: 0, total: 0 };
    byMenu.set(mKey, {
      count: prevM.count + 1,
      porsi: prevM.porsi + Number(o.jumlahPorsi || 0),
      total: prevM.total + Number(o.totalHarga || 0),
    });

    const sKey = `${o.tanggalMakan} — ${o.sesiMakan}`;
    const prevS = bySchedule.get(sKey) || { count: 0, porsi: 0 };
    bySchedule.set(sKey, {
      count: prevS.count + 1,
      porsi: prevS.porsi + Number(o.jumlahPorsi || 0),
    });
  }

  let cursor = 4;
  summarySheet.mergeCells(`A${cursor}:D${cursor}`);
  const secMenu = summarySheet.getCell(`A${cursor}`);
  secMenu.value = 'A. REKAPITULASI PER PAKET MENU';
  secMenu.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFC2410C' } };
  summarySheet.getRow(cursor).height = 22;
  cursor++;

  const menuHeader = summarySheet.getRow(cursor);
  menuHeader.values = ['Paket Menu', 'Jumlah Pesanan', 'Total Porsi', 'Total Nominal'];
  menuHeader.height = 24;
  menuHeader.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9A3412' } },
      bottom: { style: 'thin', color: { argb: 'FF9A3412' } },
      left: { style: 'thin', color: { argb: 'FFFDBA74' } },
      right: { style: 'thin', color: { argb: 'FFFDBA74' } },
    };
  });
  cursor++;

  const menuStart = cursor;
  for (const [paket, stat] of byMenu.entries()) {
    const r = summarySheet.getRow(cursor);
    r.values = [paket, stat.count, stat.porsi, stat.total];
    r.height = 21;
    r.eachCell((cell, col) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      if (col === 1) cell.alignment = { vertical: 'middle', horizontal: 'left' };
      else if (col === 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '"Rp "#,##0';
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '#,##0';
      }
    });
    cursor++;
  }

  if (byMenu.size > 0) {
    const rTotal = summarySheet.getRow(cursor);
    rTotal.values = [
      'TOTAL',
      { formula: `SUM(B${menuStart}:B${cursor - 1})` },
      { formula: `SUM(C${menuStart}:C${cursor - 1})` },
      { formula: `SUM(D${menuStart}:D${cursor - 1})` },
    ];
    rTotal.height = 23;
    rTotal.eachCell((cell, col) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF9A3412' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FFEA580C' } },
        bottom: { style: 'double', color: { argb: 'FFEA580C' } },
        left: { style: 'thin', color: { argb: 'FFFDBA74' } },
        right: { style: 'thin', color: { argb: 'FFFDBA74' } },
      };
      if (col === 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else if (col === 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '"Rp "#,##0';
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '#,##0';
      }
    });
    cursor += 2;
  }

  // Group by Schedule
  summarySheet.mergeCells(`A${cursor}:C${cursor}`);
  const secSched = summarySheet.getCell(`A${cursor}`);
  secSched.value = 'B. REKAPITULASI PER JADWAL PENGANTARAN';
  secSched.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0369A1' } };
  summarySheet.getRow(cursor).height = 22;
  cursor++;

  const schedHeader = summarySheet.getRow(cursor);
  schedHeader.values = ['Tanggal & Sesi Makan', 'Jumlah Kontingen', 'Total Porsi'];
  schedHeader.height = 24;
  for (let col = 1; col <= 3; col++) {
    const cell = schedHeader.getCell(col);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0C4A6E' } },
      bottom: { style: 'thin', color: { argb: 'FF0C4A6E' } },
      left: { style: 'thin', color: { argb: 'FF7DD3FC' } },
      right: { style: 'thin', color: { argb: 'FF7DD3FC' } },
    };
  }
  cursor++;

  const schedStart = cursor;
  for (const [jadwal, stat] of bySchedule.entries()) {
    const r = summarySheet.getRow(cursor);
    r.values = [jadwal, stat.count, stat.porsi];
    r.height = 21;
    for (let col = 1; col <= 3; col++) {
      const cell = r.getCell(col);
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      if (col === 1) cell.alignment = { vertical: 'middle', horizontal: 'left' };
      else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '#,##0';
      }
    }
    cursor++;
  }

  if (bySchedule.size > 0) {
    const rTotalSched = summarySheet.getRow(cursor);
    rTotalSched.values = [
      'TOTAL',
      { formula: `SUM(B${schedStart}:B${cursor - 1})` },
      { formula: `SUM(C${schedStart}:C${cursor - 1})` },
    ];
    rTotalSched.height = 23;
    for (let col = 1; col <= 3; col++) {
      const cell = rTotalSched.getCell(col);
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0C4A6E' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0369A1' } },
        bottom: { style: 'double', color: { argb: 'FF0369A1' } },
        left: { style: 'thin', color: { argb: 'FF7DD3FC' } },
        right: { style: 'thin', color: { argb: 'FF7DD3FC' } },
      };
      if (col === 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '#,##0';
      }
    }
  }

  // Generate & Download .xlsx
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Rekap_Katering_Garuda_IV_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
