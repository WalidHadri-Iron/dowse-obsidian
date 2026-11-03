// Synthetic native-integration fixtures; no personal vault content or external asset download.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function png() {
  const width = 512, height = 320, header = Buffer.alloc(13), pixels = Buffer.alloc(height * (1 + width * 3));
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 3) + 1 + x * 3, light = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
    pixels[i] = light ? 220 : 20; pixels[i+1] = light ? 170 : 110; pixels[i+2] = light ? 40 : 180;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function wav(seconds, bits = 16) {
  const stride = bits / 8, samples = seconds * 16000, out = Buffer.alloc(44 + samples * stride);
  out.write("RIFF"); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(16000 * stride, 28);
  out.writeUInt16LE(stride, 32); out.writeUInt16LE(bits, 34); out.write("data", 36); out.writeUInt32LE(samples * stride, 40);
  for (let i = 0; i < samples; i++) {
    const sine = Math.sin(i * 2 * Math.PI * 220 / 16000);
    if (bits === 8) out[44 + i] = Math.round(128 + 30 * sine);
    else out.writeInt16LE(Math.round(4000 * sine), 44 + i * 2);
  }
  return out;
}
function pdf() {
  const stream = "BT /F1 18 Tf 40 720 Td (Recovery certificate renewal) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(out.length); out += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
export async function mixedFixtures(vault) {
  for (const name of ["Notes", "Images", "Reports", "Audio", "Drawings"]) await mkdir(join(vault, name), { recursive: true });
  await writeFile(join(vault, "Notes/Anchor.md"), "# Recovery anchor\nFixtureanchor: rotate the expired authentication certificate and verify login.");
  for (let i = 0; i < 24; i++) await writeFile(join(vault, `Notes/Record-${i}.md`), `# Note ${i}\nA reproducible experimental report about measurements and engineering.\n`);
  await writeFile(join(vault, "Images/Pattern.png"), png());
  await writeFile(join(vault, "Reports/Recovery.pdf"), pdf());
  await writeFile(join(vault, "Board.canvas"), JSON.stringify({ nodes: [{ id: "first", type: "text", x: 0, y: 0, width: 300, height: 150, text: "Certificate renewal checklist" }], edges: [] }));
  // The accepted recording crosses two processor checkpoints. The other must be rejected by metadata before decode.
  await writeFile(join(vault, "Audio/Over-limit.wav"), wav(1201, 8));
  await writeFile(join(vault, "Audio/Long.wav"), wav(620));
}
