# Security Specification — Catering Garuda IV SMKS PGRI 1 Sukabumi

## 1. Data Invariants
1. **Menu Catalog (`menus/{menuId}`)**:
   - Publicly readable so visiting school officials can browse catering packages.
   - Only verified admins (`diyanto13@gmail.com` or UID in `/admins/{uid}`) can create, update, or delete menu items.
   - Every `menuId` must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` chars.
   - `harga` must be a positive number (`> 0 && <= 10000000`), `urutan` must be `>= 0 && <= 10000`.
2. **Orders (`orders/{orderId}`)**:
   - Contains PII (`namaSekolah`, `namaPj`, `noWa`, `fileUrl` proof of transfer).
   - `get`, `list`, `update`, and `delete` are strictly restricted to `isAdmin()`. No public or non-admin reads are ever allowed.
   - `create` is allowed for public order submission only if `isValidId(orderId)` AND `isValidOrder(incoming())` pass all schema, size, regex, enum, math (`totalHarga == hargaSatuan * jumlahPorsi`), and server timestamp (`createdAt == request.time`) invariants.
3. **Admins (`admins/{userId}`)**:
   - Strictly restricted to `isAdmin()` so regular users cannot read admin lists or escalate privileges.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Order Read/List**: Non-admin requests `getDocs(collection(db, 'orders'))` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection on Order Create**: Payload includes extra key `isVerified: true` -> `PERMISSION_DENIED` (`hasOnly`).
3. **Price Tampering on Order Create**: `hargaSatuan: 25000`, `jumlahPorsi: 10`, `totalHarga: 1000` -> `PERMISSION_DENIED` (`totalHarga == hargaSatuan * jumlahPorsi`).
4. **Timestamp Forgery on Order Create**: `createdAt` set to past/future client timestamp instead of `serverTimestamp()` -> `PERMISSION_DENIED` (`createdAt == request.time`).
5. **ID Poisoning on Order Create**: Document ID contains 200+ characters or `/` or spaces -> `PERMISSION_DENIED` (`isValidId`).
6. **Oversized String / Denial of Wallet**: `catatan` > 500 chars or `fileUrl` > 750000 chars -> `PERMISSION_DENIED`.
7. **Invalid WhatsApp Format**: `noWa: "08123"` (not normalized `62...`) -> `PERMISSION_DENIED` (`matches('^62[0-9]{7,18}$')`).
8. **Invalid Enum Value**: `tanggalMakan: "Senin, 1 Jan 2026"` or `sesiMakan: "Tengah Malam"` -> `PERMISSION_DENIED`.
9. **Unauthenticated Menu Mutation**: Non-admin attempts to create/update/delete `menus/PKT-01` -> `PERMISSION_DENIED`.
10. **Email Spoofing Attack**: User with `email == 'diyanto13@gmail.com'` and `email_verified == false` attempts admin read -> `PERMISSION_DENIED`.
11. **Self-Privilege Escalation**: Non-admin tries to write `/admins/{theirUid}` -> `PERMISSION_DENIED`.
12. **Unauthenticated Order Update/Delete**: Non-admin attempts to modify or delete `/orders/{orderId}` -> `PERMISSION_DENIED`.
