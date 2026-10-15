// Game (ROM) folders of one emulator: list with game counts, add, open, remove.
// Used on the emulator's page and in Settings → Emulators.
const RomFolders = (() => {
  const short = (p) => (p.length > 60 ? '…' + p.slice(-58) : p);

  async function edit(moduleId) {
    let focus = 'add';
    for (;;) {
      const info = await api.emulatorFolders(moduleId);
      const cores = await api.emulatorCores(moduleId); // RetroArch only
      const coreLabel = (f, i) => (cores ? `  ·  core: ${f.core || `auto (${(cores.auto[i] || 'none found')})`}` : '');
      if (!info) { UI.toast('This emulator was not found in Emu_modules', { icon: 'alert', error: true }); return; }
      const total = info.folders.reduce((n, f) => n + f.games, 0);
      const types = (info.romExtensions || []).slice(0, 8).join(', ');
      const items = info.folders.map((f, i) => ({
        label: `${short(f.folder)}  ·  ${f.exists ? `${f.games} game${f.games === 1 ? '' : 's'}` : 'not found'}${coreLabel(f, i)}`,
        icon: f.exists ? 'folder' : 'alert', value: i,
      }));
      items.push({ label: 'Add a folder…', icon: 'plus', value: 'add' });
      items.push({ label: 'Done', icon: 'check', value: 'done' });
      const message = info.folders.length
        ? `${total} game${total === 1 ? '' : 's'} found${types ? `  ·  looks for ${types}${info.romExtensions.length > 8 ? ' …' : ''}` : ''}`
        : `No game folders yet.${types ? ` Games are files like ${types}.` : ''}`;

      const c = await UI.menu({ title: `${info.name}: game folders`, message, items, focus });
      if (c === null || c === 'done') return;
      // Saved as a path, or { path, core (RetroArch), system (e.g. ares: "Mega Drive") }
      const entry = (f, core) => (core || f.system || f.names ? { path: f.folder, ...(core ? { core } : {}), ...(f.system ? { system: f.system } : {}), ...(f.names ? { names: f.names } : {}) } : f.folder);
      const entries = info.folders.map((f) => entry(f, f.core));
      const folders = info.folders.map((f) => f.folder);

      if (c === 'add') {
        const picked = await api.pickFile({ title: `Folder with ${info.name} games`, folder: true, defaultPath: folders[folders.length - 1] });
        if (picked) {
          if (folders.includes(picked)) UI.toast('That folder is already in the list', { icon: 'folder' });
          else { await api.setEmulatorFolders(moduleId, [...entries, picked]); UI.toast('Folder added', { icon: 'folder' }); }
        }
        focus = 'add';
        continue;
      }

      const f = info.folders[c];
      const what = await UI.menu({ title: short(f.folder), message: f.exists ? `${f.games} games in this folder` : 'This folder was not found (drive not connected?)', items: [
        ...(f.exists ? [{ label: 'Open in Explorer', icon: 'external', value: 'open' }] : []),
        ...(cores ? [{ label: `RetroArch core: ${f.core || `automatic (${cores.auto[c] || 'none found'})`}`, icon: 'gamepad', value: 'core' }] : []),
        { label: 'Remove from the list', icon: 'trash', value: 'remove', danger: true },
        { label: 'Back', icon: 'back', value: 'back' },
      ] });
      if (what === 'open') api.openPath(f.folder);
      if (what === 'remove') {
        await api.setEmulatorFolders(moduleId, entries.filter((x, i) => i !== c));
        UI.toast('Folder removed from the list (nothing deleted)', { icon: 'folder' });
      }
      if (what === 'core') {
        const pick = await UI.menu({ title: 'RetroArch core', message: `For the games in ${short(f.folder)}`, focus: f.core || '',
          items: [{ label: `Automatic (${cores.auto[c] || 'none found'})`, value: '', icon: f.core ? '' : 'check' },
            ...cores.cores.map((x) => ({ label: x, value: x, icon: x === f.core ? 'check' : '' }))] });
        if (pick !== null && pick !== undefined) {
          entries[c] = entry(f, pick);
          await api.setEmulatorFolders(moduleId, entries);
        }
      }
      focus = what === 'remove' ? 'add' : c;
    }
  }

  return { edit };
})();
