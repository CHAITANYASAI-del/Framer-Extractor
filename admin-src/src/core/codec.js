// Framer CMS binary codec (.framercms) — decode + encode.
// Format (mirrors Framer's runtime reader/writer):
//   chunk  = u32 itemCount, items…
//   item   = u16 fieldCount, (string key, value)…
//   string = u32 byteLength + UTF-8
//   value  = u8 tag + payload. Tags: 0 null, 1 array, 2 boolean, 3 color,
//            4 date(i64 ms), 5 enum, 6 file, 7 link(json), 8 number(f64),
//            9 object, 10 responsive image(json), 11 rich text (i8 kind:
//            0 → u32 ref, 1 → string), 12 string, 13 vector set item (u32)
// Round-trips byte-identically with Framer's own files.

const td = new TextDecoder();
const te = new TextEncoder();

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.o = 0;
  }
  need(n) { if (this.o + n > this.b.length) throw new Error('CMS data truncated'); }
  u8()  { this.need(1); return this.v.getUint8(this.o++); }
  i8()  { this.need(1); return this.v.getInt8(this.o++); }
  u16() { this.need(2); const x = this.v.getUint16(this.o); this.o += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.o); this.o += 4; return x; }
  i64() { this.need(8); const x = Number(this.v.getBigInt64(this.o)); this.o += 8; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.o); this.o += 8; return x; }
  str() { const n = this.u32(); this.need(n); const s = td.decode(this.b.subarray(this.o, this.o + n)); this.o += n; return s; }
  json() { const s = this.str(); try { return JSON.parse(s); } catch { return s; } }
}

function readValue(r) {
  const tag = r.u8();
  switch (tag) {
    case 0: return { t: 'null', v: null };
    case 1: { const n = r.u16(), a = []; for (let i = 0; i < n; i++) a.push(readValue(r)); return { t: 'array', v: a }; }
    case 2: return { t: 'boolean', v: r.u8() !== 0 };
    case 3: return { t: 'color', v: r.str() };
    case 4: return { t: 'date', v: new Date(r.i64()).toISOString() };
    case 5: return { t: 'enum', v: r.str() };
    case 6: return { t: 'file', v: r.str() };
    case 7: return { t: 'link', v: r.json() };
    case 8: return { t: 'number', v: r.f64() };
    case 9: { const n = r.u16(), o = {}; for (let i = 0; i < n; i++) { const k = r.str(); o[k] = readValue(r); } return { t: 'object', v: o }; }
    case 10: return { t: 'image', v: r.json() };
    case 11: return r.i8() === 0 ? { t: 'richtextRef', v: r.u32() } : { t: 'richtext', v: r.str() };
    case 12: return { t: 'string', v: r.str() };
    case 13: return { t: 'vector', v: r.u32() };
    default: throw new Error('Unknown CMS value type ' + tag);
  }
}

export function decodeChunk(bytes) {
  const r = new Reader(bytes), count = r.u32(), items = [];
  for (let i = 0; i < count; i++) {
    const fc = r.u16(), item = {};
    for (let j = 0; j < fc; j++) { const k = r.str(); item[k] = readValue(r); }
    items.push(item);
  }
  return items;
}

class Writer {
  constructor() { this.parts = []; this.len = 0; }
  push(u8a) { this.parts.push(u8a); this.len += u8a.length; }
  num(n, fn) { const b = new Uint8Array(n); fn(new DataView(b.buffer)); this.push(b); }
  u8(x)  { this.num(1, d => d.setUint8(0, x)); }
  i8(x)  { this.num(1, d => d.setInt8(0, x)); }
  u16(x) { this.num(2, d => d.setUint16(0, x)); }
  u32(x) { this.num(4, d => d.setUint32(0, x)); }
  i64(x) { this.num(8, d => d.setBigInt64(0, BigInt(Math.round(x)))); }
  f64(x) { this.num(8, d => d.setFloat64(0, x)); }
  str(s) { const e = te.encode(String(s ?? '')); this.u32(e.length); this.push(e); }
  bytes() { const out = new Uint8Array(this.len); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}

function writeValue(w, x) {
  if (!x) { w.u8(0); return; }
  switch (x.t) {
    case 'null': w.u8(0); break;
    case 'array': w.u8(1); w.u16(x.v.length); x.v.forEach(e => writeValue(w, e)); break;
    case 'boolean': w.u8(2); w.u8(x.v ? 1 : 0); break;
    case 'color': w.u8(3); w.str(x.v); break;
    case 'date': w.u8(4); w.i64(Date.parse(x.v) || 0); break;
    case 'enum': w.u8(5); w.str(x.v); break;
    case 'file': w.u8(6); w.str(x.v); break;
    case 'link': w.u8(7); w.str(typeof x.v === 'string' ? JSON.stringify(x.v) : JSON.stringify(x.v ?? null)); break;
    case 'number': w.u8(8); w.f64(Number(x.v) || 0); break;
    case 'object': { w.u8(9); const k = Object.keys(x.v || {}); w.u16(k.length); k.forEach(kk => { w.str(kk); writeValue(w, x.v[kk]); }); break; }
    case 'image': w.u8(10); w.str(JSON.stringify(x.v)); break;
    case 'richtextRef': w.u8(11); w.i8(0); w.u32(x.v); break;
    case 'richtext': w.u8(11); w.i8(1); w.str(x.v); break;
    case 'string': w.u8(12); w.str(x.v); break;
    case 'vector': w.u8(13); w.u32(x.v); break;
    default: throw new Error('Cannot encode CMS value type ' + x.t);
  }
}

export function encodeChunk(items) {
  const w = new Writer();
  w.u32(items.length);
  for (const it of items) {
    const keys = Object.keys(it);
    w.u16(keys.length);
    for (const k of keys) { w.str(k); writeValue(w, it[k]); }
  }
  return w.bytes();
}
