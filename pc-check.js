// "Check this PC": what MediaDeck's emulators, apps and PC games need from Windows on this PC - by reading which DLLs
// their programs load - and what is missing: Visual C++ / DirectX / .NET runtimes (MediaDeck installs them from
// Microsoft), emulator and app programs that are gone (installed again), the controller driver, and what it can't
// install (a Vulkan graphics driver, game folders that aren't there). Runs by itself on another PC than last time
// (main.js), or from Settings. Reads only.
const fs = require('fs');
const path = require('path');

const WIN = process.env.SystemRoot || 'C:\\Windows';
// Runtimes MediaDeck can put in: Microsoft's own downloads (the aka.ms links always give the newest)
const RUNTIMES = {
  vc14x64: { name: 'Visual C++ 2015-2022 runtime (64-bit)', url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe', args: ['/install', '/passive', '/norestart'] },
  vc14x86: { name: 'Visual C++ 2015-2022 runtime (32-bit)', url: 'https://aka.ms/vs/17/release/vc_redist.x86.exe', args: ['/install', '/passive', '/norestart'] },
  vc12x64: { name: 'Visual C++ 2013 runtime (64-bit)', url: 'https://aka.ms/highdpimfc2013x64enu', file: 'vcredist2013_x64.exe', args: ['/install', '/passive', '/norestart'] },
  vc12x86: { name: 'Visual C++ 2013 runtime (32-bit)', url: 'https://aka.ms/highdpimfc2013x86enu', file: 'vcredist2013_x86.exe', args: ['/install', '/passive', '/norestart'] },
  vc10x64: { name: 'Visual C++ 2010 runtime (64-bit)', url: 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe', file: 'vcredist2010_x64.exe', args: ['/passive', '/norestart'] },
  vc10x86: { name: 'Visual C++ 2010 runtime (32-bit)', url: 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe', file: 'vcredist2010_x86.exe', args: ['/passive', '/norestart'] },
  // unpacked first (/Q /T:<folder>), then its DXSETUP.exe /silent
  directx: { name: 'DirectX 9 runtime (June 2010)', url: 'https://download.microsoft.com/download/8/4/A/84A35BF1-DAFE-4AE8-82AF-AD2AE20B6B14/directx_Jun2010_redist.exe', unpack: true },
};
// .NET (programs with a <name>.runtimeconfig.json): the runtime of that major version
function dotnetRuntime(framework, major) {
  const desktop = /WindowsDesktop/i.test(framework);
  return { name: `.NET ${major} ${desktop ? 'Desktop ' : ''}Runtime`, url: `https://aka.ms/dotnet/${major}.0/${desktop ? 'windowsdesktop-runtime' : 'dotnet-runtime'}-win-x64.exe`,
    args: ['/install', '/passive', '/norestart'] };
}
// Which runtime a DLL comes from (vc14 / vc12 / vc10 + the program's bitness)
const DLL_RUNTIME = [
  [/^(vcruntime140(_1|_threads)?|msvcp140(_\d|_atomic_wait|_codecvt_ids)?|concrt140|vcomp140|vccorlib140|mfc140u?|vcamp140)\.dll$/i, 'vc14'],
  [/^(msvcr120|msvcp120|vcomp120|mfc120u?|vccorlib120)\.dll$/i, 'vc12'],
  [/^(msvcr100|msvcp100|vcomp100|mfc100u?)\.dll$/i, 'vc10'],
  [/^(d3dx9_\d+|d3dx10(_\d+)?|d3dx11_\d+|d3dcompiler_(3[3-9]|4[0-3])|xinput1_[123]|xaudio2_[0-7]|x3daudio1_[0-7]|xactengine\d_\d+|d3dcsx_\d+|xapofx1_\d)\.dll$/i, 'directx'],
];
const runtimeOf = (dll, x86) => { const r = DLL_RUNTIME.find(([re]) => re.test(dll)); return r ? (r[1] === 'directx' ? 'directx' : r[1] + (x86 ? 'x86' : 'x64')) : null; };

// ---------- A program's imports (its PE header; nothing is run) ----------
function readPe(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    if (read(0, 2).toString('latin1') !== 'MZ') return null;
    const pe = read(0x3c, 4).readUInt32LE(0);
    if (read(pe, 4).toString('latin1') !== 'PE\0\0') return null;
    const coff = read(pe + 4, 20), machine = coff.readUInt16LE(0), nSec = coff.readUInt16LE(2), optSize = coff.readUInt16LE(16);
    const opt = read(pe + 24, optSize), plus = opt.readUInt16LE(0) === 0x20b, dd = plus ? 112 : 96;
    const dir = (i) => (dd + i * 8 + 8 <= optSize ? { rva: opt.readUInt32LE(dd + i * 8), size: opt.readUInt32LE(dd + i * 8 + 4) } : { rva: 0 });
    const st = read(pe + 24 + optSize, nSec * 40), secs = [];
    for (let i = 0; i < nSec; i++) secs.push({ va: st.readUInt32LE(i * 40 + 12), vs: Math.max(st.readUInt32LE(i * 40 + 8), st.readUInt32LE(i * 40 + 16)), raw: st.readUInt32LE(i * 40 + 20) });
    const off = (rva) => { const s = secs.find((x) => rva >= x.va && rva < x.va + x.vs); return s ? rva - s.va + s.raw : -1; };
    const str = (rva) => { const o = off(rva); if (o < 0) return ''; const b = read(o, 260); return b.toString('latin1', 0, Math.max(0, b.indexOf(0))); };
    const imports = [];
    for (const [i, step, at] of [[1, 20, 12], [13, 32, 4]]) {
      const d = dir(i);
      if (!d.rva) continue;
      for (let o = off(d.rva), n = 0; o >= 0 && n < 400; o += step, n++) {
        const name = read(o, step).readUInt32LE(at);
        if (!name) break;
        const dll = str(name);
        if (dll) imports.push({ dll, delay: i === 13 });
      }
    }
    return { x86: machine === 0x14c, imports, managed: !!dir(14).rva };
  } finally { fs.closeSync(fd); }
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// Windows' own API sets (api-ms-…, ext-ms-…) are never files of their own
const apiSet = (dll) => /^(api|ext)-ms-/i.test(dll);
function found(dll, dirs) { return apiSet(dll) || dirs.some((d) => isFile(path.join(d, dll))); }
// .NET programs: the runtime their runtimeconfig.json asks for, when this PC doesn't have that major version
function dotnetNeed(exe) {
  const cfg = exe.replace(/\.exe$/i, '.runtimeconfig.json');
  let j;
  try { j = JSON.parse(fs.readFileSync(cfg, 'utf8')); } catch { return []; }
  const fw = [].concat((j.runtimeOptions || {}).frameworks || [], (j.runtimeOptions || {}).framework || []);
  const out = [];
  for (const f of fw) {
    const major = String(f.version || '').split('.')[0];
    if (!f.name || !major) continue;
    let have = false;
    try { have = fs.readdirSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'shared', f.name)).some((v) => v.split('.')[0] === major); } catch {}
    if (!have) out.push({ key: `dotnet-${f.name}-${major}`, ...dotnetRuntime(f.name, major) });
  }
  return out;
}

// What one program needs that this PC lacks: { runtimes: Set, dlls: [names], dotnet: [...] }
// (the DLLs next to it are read too, for the runtimes only: Qt's DLLs load the Visual C++ runtime)
function programNeeds(exe) {
  const out = { runtimes: new Set(), dlls: [], dotnet: dotnetNeed(exe) };
  const pe = (() => { try { return readPe(exe); } catch { return null; } })();
  if (!pe) return out;
  const dir = path.dirname(exe);
  const sys = path.join(WIN, pe.x86 ? 'SysWOW64' : 'System32');
  const dirs = [dir, sys, WIN];
  for (const { dll, delay } of pe.imports) {
    if (found(dll, dirs)) continue;
    const r = runtimeOf(dll, pe.x86);
    if (r) out.runtimes.add(r);
    else if (!delay) out.dlls.push(dll);
  }
  let near = [];
  try { near = fs.readdirSync(dir).filter((f) => /\.dll$/i.test(f)).slice(0, 120); } catch {}
  for (const f of near) {
    const p = (() => { try { return readPe(path.join(dir, f)); } catch { return null; } })();
    if (!p) continue;
    for (const { dll } of p.imports) {
      const r = !found(dll, [dir, path.join(WIN, p.x86 ? 'SysWOW64' : 'System32'), WIN]) && runtimeOf(dll, p.x86);
      if (r) out.runtimes.add(r);
    }
  }
  return out;
}

// The whole check. programs: [{ name, exe, kind: 'emulator' | 'app' | 'game', fix?: { kind, id } }] (main.js lists
// them); extra: notes found elsewhere. Returns { fixes: [{ key, kind, name, for: [names] }], notes: [text] }.
function check(programs, extra = []) {
  const runtimes = new Map();   // key -> { …, for: Set }
  const fixes = [];
  const notes = [...extra];
  const want = (key, def, who) => { if (!runtimes.has(key)) runtimes.set(key, { key, kind: 'runtime', ...def, for: new Set() }); runtimes.get(key).for.add(who); };
  for (const p of programs) {
    if (!isFile(p.exe)) {
      if (p.fix) fixes.push({ key: `${p.fix.kind}:${p.fix.id}`, kind: p.fix.kind, id: p.fix.id, name: `${p.name}: its program is missing - install it again`, for: [p.name] });
      else notes.push(`${p.name}: ${path.basename(p.exe)} isn't there`);
      continue;
    }
    const n = programNeeds(p.exe);
    for (const r of n.runtimes) want(r, RUNTIMES[r], p.name);
    for (const d of n.dotnet) want(d.key, d, p.name);
    // (vulkan-1.dll: the graphics driver's, one note below for all)
    const dlls = n.dlls.filter((d) => !/^vulkan-1\.dll$/i.test(d));
    if (dlls.length) notes.push(`${p.name}: ${dlls.slice(0, 4).join(', ')} not found`);
  }
  // Vulkan comes with the graphics driver
  if (!isFile(path.join(WIN, 'System32', 'vulkan-1.dll'))) notes.push('No Vulkan graphics driver: emulators like Eden, RPCS3, Xenia and Cemu need it - install the newest driver for your graphics card');
  // the .NET Desktop Runtime has the plain .NET Runtime of its version in it
  for (const k of [...runtimes.keys()]) {
    const m = /^dotnet-Microsoft\.NETCore\.App-(\d+)$/.exec(k);
    const desk = m && runtimes.get(`dotnet-Microsoft.WindowsDesktop.App-${m[1]}`);
    if (desk) { for (const w of runtimes.get(k).for) desk.for.add(w); runtimes.delete(k); }
  }
  const order = (k) => ['vc14x64', 'vc14x86', 'vc12x64', 'vc12x86', 'vc10x64', 'vc10x86', 'directx'].indexOf(k);
  const rt = [...runtimes.values()].sort((a, b) => order(a.key) - order(b.key)).map((r) => ({ ...r, for: [...r.for] }));
  return { fixes: [...rt, ...fixes], notes: [...new Set(notes)] };
}

module.exports = { check, RUNTIMES, readPe, programNeeds };
