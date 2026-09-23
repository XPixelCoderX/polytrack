const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";

// mirror of the obfuscator's decoder
function decode(s) {
  let out = "", pct = "";
  for (let i = 0, bits = 0, acc, ch, p = 0; (ch = s.charAt(p++)); ) {
    ch = ALPHA.indexOf(ch);
    if (~ch) {
      acc = i % 4 ? acc * 64 + ch : ch;
      if (i++ % 4) out += String.fromCharCode(255 & (acc >> ((-2 * i) & 6)));
    }
  }
  for (let i = 0; i < out.length; i++)
    pct += "%" + ("00" + out.charCodeAt(i).toString(16)).slice(-2);
  return decodeURIComponent(pct);
}

function encode(str) {
  // percent-encode to latin1 byte string, then custom-base64
  const pct = encodeURIComponent(str);
  let bytes = "";
  for (let i = 0; i < pct.length; i++) {
    if (pct[i] === "%") { bytes += String.fromCharCode(parseInt(pct.substr(i + 1, 2), 16)); i += 2; }
    else bytes += pct[i];
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes.charCodeAt(i);
    const b1 = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
    const b2 = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
    const e0 = b0 >> 2;
    const e1 = ((b0 & 3) << 4) | (isNaN(b1) ? 0 : b1 >> 4);
    const e2 = isNaN(b1) ? 64 : ((b1 & 15) << 2) | (isNaN(b2) ? 0 : b2 >> 6);
    const e3 = isNaN(b2) ? 64 : b2 & 63;
    out += ALPHA[e0] + ALPHA[e1] + ALPHA[e2] + ALPHA[e3];
  }
  return out.replace(/=+$/, "");
}

module.exports = { encode, decode };

if (require.main === module) {
  const tests = ["PolyTraqqq", "N2AB Client", "https://polytraqqq.com", "a", "ab", "abc",
    "2026 PolyTraqqq Cheat Client - ", "Speed multiplier", "café ✓ 日本"];
  let ok = true;
  for (const t of tests) {
    const r = decode(encode(t));
    if (r !== t) { ok = false; console.log("FAIL", JSON.stringify(t), "->", JSON.stringify(r)); }
  }
  console.log(ok ? "round-trip OK" : "ROUND-TRIP BROKEN");
  console.log("PolyTraqqq  =>", encode("PolyTraqqq"));
  console.log("N2AB Client =>", encode("N2AB Client"));
}
