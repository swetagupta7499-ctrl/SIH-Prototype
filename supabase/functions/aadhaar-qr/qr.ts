// ===========================================================================
// Aadhaar Secure QR — decode + UIDAI signature check (no network, no licence)
//
// QR payload: a base-10 number → big-endian bytes → GZIP. Inside:
//   [V2|V3|… 0xFF] email_mobile_flag 0xFF reference_id 0xFF name 0xFF dob 0xFF
//   gender 0xFF care_of 0xFF district 0xFF landmark 0xFF house 0xFF location 0xFF
//   pincode 0xFF post_office 0xFF state 0xFF street 0xFF sub_district 0xFF vtc
//   0xFF [mobile last 4 0xFF] photo (JPEG 2000) … [hashes] signature (256 B)
// The last 256 bytes are UIDAI's RSA-2048 SHA-256 signature over everything
// before them, so any edit to name/DOB/photo fails verification.
//
// Pure module (Web Crypto + DecompressionStream only) so it runs in Deno and Node.
// ===========================================================================

export type UidaiKey = { id: string; spki: string };

export type AadhaarQrResult = {
  signatureValid: boolean;
  keyId: string | null;
  version: string | null;
  name: string;
  dob: string;
  gender: string;
  district: string;
  state: string;
  pincode: string;
  aadhaarLast4: string;
  generatedAt: string | null;
};

const MAX_DECOMPRESSED = 64 * 1024; // real payloads are ~2–5 KB; stops gzip bombs
const SIGNATURE_BYTES = 256;
const FIELDS = [
  "emailMobileFlag", "referenceId", "name", "dob", "gender", "careOf", "district",
  "landmark", "house", "location", "pincode", "postOffice", "state", "street",
  "subDistrict", "vtc",
];

export class QrError extends Error {}

function decimalToBytes(digits: string): Uint8Array {
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECOMPRESSED) {
      await reader.cancel();
      throw new QrError("QR data is too large to be an Aadhaar Secure QR.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function findSigningKey(signed: Uint8Array, signature: Uint8Array, keys: UidaiKey[]): Promise<string | null> {
  for (const key of keys) {
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(key.spki),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signed)) return key.id;
  }
  return null;
}

/* Reference ID = last 4 Aadhaar digits + issue timestamp (YYYYMMDDhhmmss…). */
function parseGeneratedAt(ref: string): string | null {
  const m = ref.slice(4).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30` : null;
}

export async function verifyAadhaarQr(rawQr: string, keys: UidaiKey[]): Promise<AadhaarQrResult> {
  const digits = String(rawQr ?? "").replace(/\s+/g, "");
  if (!/^\d{200,}$/.test(digits)) {
    throw new QrError(
      "This is not an Aadhaar Secure QR. Scan the large QR code on an Aadhaar letter, e-Aadhaar PDF, PVC card or the mAadhaar app.",
    );
  }

  let data: Uint8Array;
  try {
    data = await gunzip(decimalToBytes(digits));
  } catch (e) {
    if (e instanceof QrError) throw e;
    throw new QrError("The QR code could not be decoded. It may be an old (unsigned) Aadhaar QR or damaged.");
  }
  if (data.length <= SIGNATURE_BYTES + 32) throw new QrError("The QR data is incomplete.");

  const signed = data.subarray(0, data.length - SIGNATURE_BYTES);
  const signature = data.subarray(data.length - SIGNATURE_BYTES);
  const keyId = await findSigningKey(signed, signature, keys);

  // Text fields are 0xFF-delimited at the start of the signed data.
  const decoder = new TextDecoder("utf-8");
  let pos = 0;
  const next = () => {
    const end = signed.indexOf(0xff, pos);
    if (end === -1) throw new QrError("The QR data is incomplete.");
    const value = decoder.decode(signed.subarray(pos, end)).trim();
    pos = end + 1;
    return value;
  };

  let version: string | null = null;
  if (signed[0] === 0x56 /* V */ && signed[1] >= 0x30 && signed[1] <= 0x39) version = next();
  const f: Record<string, string> = {};
  for (const name of FIELDS) f[name] = next();

  return {
    signatureValid: keyId !== null,
    keyId,
    version,
    name: f.name,
    dob: f.dob,
    gender: f.gender,
    district: f.district,
    state: f.state,
    pincode: f.pincode,
    aadhaarLast4: f.referenceId.slice(0, 4),
    generatedAt: parseGeneratedAt(f.referenceId),
  };
}
