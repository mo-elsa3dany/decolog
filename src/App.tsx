import { useEffect, useState } from 'react';
import {
  seedIfEmpty,
  getDives,
  addDive,
  updateDive,
  deleteDive,
  isUnlocked,
  setUnlocked,
  type StoredDive,
} from './storage';

type Tab = 'log' | 'stats' | 'more';
type GasMode = 'AIR' | 'NITROX';
type Units = 'metric' | 'imperial';
type CylinderProfileId = 'AL80' | 'HP100' | 'CUSTOM';

const CYL_PROFILES: { id: CylinderProfileId; label: string; liters: number | null }[] = [
  { id: 'AL80', label: 'AL80 (11.1 L)', liters: 11.1 },
  { id: 'HP100', label: 'HP100 (13.2 L)', liters: 13.2 },
  { id: 'CUSTOM', label: 'Custom', liters: null },
];

function resolveCylinderProfile(cylLiters: number): CylinderProfileId {
  const diff = (a: number, b: number) => Math.abs(a - b);
  if (diff(cylLiters, 11.1) < 0.3) return 'AL80';
  if (diff(cylLiters, 13.2) < 0.3) return 'HP100';
  return 'CUSTOM';
}

function computeMOD(o2Percent: number, ppO2: number, units: Units) {
  if (!o2Percent || !ppO2) return '—';
  const frac = o2Percent / 100;
  if (frac <= 0) return '—';
  const ata = ppO2 / frac;
  const meters = (ata - 1) * 10;
  if (meters <= 0) return '—';
  if (units === 'imperial') {
    const ft = meters * 3.28084;
    return `${ft.toFixed(0)} ft`;
  }
  return `${meters.toFixed(0)} m`;
}

function depthLabel(depthMeters: number, units: Units): string {
  if (units === 'imperial') {
    const ft = depthMeters * 3.28084;
    return `${ft.toFixed(0)} ft`;
  }
  return `${depthMeters} m`;
}

function sacLabel(sacLpm: number, units: Units): string {
  if (!sacLpm) return units === 'imperial' ? '— cu ft/min' : '— L/min';
  if (units === 'imperial') {
    const cuft = sacLpm / 28.317;
    return `${cuft.toFixed(2)} cu ft/min`;
  }
  return `${sacLpm.toFixed(1)} L/min`;
}

function pressureLabel(bar: number, units: Units): string {
  if (units === 'imperial') {
    const psi = bar * 14.5038;
    return `${psi.toFixed(0)} psi`;
  }
  return `${bar} bar`;
}

function cylLabel(liters: number, units: Units): string {
  if (units === 'imperial') {
    const cuft = liters / 28.317;
    return `${cuft.toFixed(1)} cu ft equiv`;
  }
  return `${liters} L`;
}

// CSV cell escaping
function csvCell(value: unknown): string {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('log');
  const [dives, setDives] = useState<StoredDive[]>([]);
  const [loading, setLoading] = useState(true);

  const [isAdding, setIsAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const [newSite, setNewSite] = useState('');
  const [newDepth, setNewDepth] = useState('18');
  const [newTime, setNewTime] = useState('42');
  const [newStart, setNewStart] = useState('210');
  const [newEnd, setNewEnd] = useState('70');
  const [newCyl, setNewCyl] = useState('11.1'); // AL80

  const [gasMode, setGasMode] = useState<GasMode>('AIR');
  const [o2Percent, setO2Percent] = useState('21');
  const [ppO2Limit, setPpO2Limit] = useState('1.4');

  const [cylProfile, setCylProfile] = useState<CylinderProfileId>('AL80');

  const [unlocked, setUnlockedState] = useState(false);

  const [units, setUnits] = useState<Units>(() => {
    if (typeof window === 'undefined') return 'metric';
    const saved = window.localStorage.getItem('decolog.units');
    if (saved === 'metric' || saved === 'imperial') return saved;
    return 'metric';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('decolog.units', units);
  }, [units]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const list = await seedIfEmpty();
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setDives(list);
      setUnlockedState(isUnlocked());
      setLoading(false);
    })();
  }, []);

  async function reload() {
    const list = await getDives();
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setDives(list);
  }

  function resetForm() {
    setIsAdding(false);
    setEditId(null);
    setNewSite('');
    setNewDepth('18');
    setNewTime('42');
    setNewStart('210');
    setNewEnd('70');
    setNewCyl('11.1');
    setGasMode('AIR');
    setO2Percent('21');
    setPpO2Limit('1.4');
    setCylProfile('AL80');
  }

  function computeSacLitersPerMinute(opts: {
    depthMeters: number;
    timeMinutes: number;
    startPressureBar: number;
    endPressureBar: number;
    cylLiters: number;
  }): number {
    const { depthMeters, timeMinutes, startPressureBar, endPressureBar, cylLiters } = opts;
    if (timeMinutes <= 0) return 0;
    if (endPressureBar >= startPressureBar) return 0;

    const deltaP = startPressureBar - endPressureBar;
    const gasUsedSurfaceLiters = deltaP * cylLiters;
    const ambientPressure = depthMeters / 10 + 1;
    if (ambientPressure <= 0) return 0;

    return gasUsedSurfaceLiters / timeMinutes / ambientPressure;
  }

  async function handleSaveNewDive(e: React.FormEvent) {
    e.preventDefault();

    const depth = Number(newDepth) || 0;
    const time = Number(newTime) || 0;
    const startP = Number(newStart) || 0;
    const endP = Number(newEnd) || 0;
    const cyl = Number(newCyl) || 11.1;
    const o2 = Number(o2Percent) || (gasMode === 'AIR' ? 21 : 32);

    const sac = computeSacLitersPerMinute({
      depthMeters: depth,
      timeMinutes: time,
      startPressureBar: startP,
      endPressureBar: endP,
      cylLiters: cyl,
    });

    const gasString = gasMode === 'AIR' ? 'AIR' : `EAN${Math.round(o2)}`;

    if (editId != null) {
      await updateDive(editId, {
        site: newSite.trim() || 'UNNAMED DIVE',
        depth,
        time,
        startPressure: startP,
        endPressure: endP,
        cylLiters: cyl,
        sac,
        gas: gasString,
      });
    } else {
      await addDive({
        site: newSite.trim() || 'UNNAMED DIVE',
        depth,
        time,
        startPressure: startP,
        endPressure: endP,
        cylLiters: cyl,
        sac,
        gas: gasString,
      });
    }

    await reload();
    resetForm();
  }

  function handleCancelNewDive() {
    resetForm();
  }

  function handleStartNewDive() {
    if (!unlocked && dives.length >= 10) {
      alert('Free limit reached. Unlock DecoLog to continue.');
      return;
    }
    setEditId(null);
    setNewSite('');
    setNewDepth('18');
    setNewTime('42');
    setNewStart('210');
    setNewEnd('70');
    setNewCyl('11.1');
    setGasMode('AIR');
    setO2Percent('21');
    setPpO2Limit('1.4');
    setCylProfile('AL80');
    setIsAdding(true);
  }

  function handleEditDive(dive: StoredDive) {
    if (dive.id == null) return;
    setTab('log');
    setIsAdding(true);
    setEditId(dive.id);
    setNewSite(dive.site);
    setNewDepth(String(dive.depth));
    setNewTime(String(dive.time));
    setNewStart(String(dive.startPressure));
    setNewEnd(String(dive.endPressure));
    setNewCyl(String(dive.cylLiters));
    setCylProfile(resolveCylinderProfile(dive.cylLiters));

    let mode: GasMode = 'AIR';
    let o2 = '21';
    const gasStr = (dive.gas || '').toUpperCase();
    if (gasStr !== 'AIR') {
      mode = 'NITROX';
      const match = gasStr.match(/EAN(\d+)/);
      if (match) o2 = match[1];
    }
    setGasMode(mode);
    setO2Percent(o2);
    setPpO2Limit('1.4');
  }

  async function handleDeleteDive(id?: number) {
    if (id == null) return;
    if (!window.confirm('Remove this dive from the log?')) return;
    await deleteDive(id);
    await reload();
  }

  function handleExportJson() {
    if (!dives.length) {
      alert('No dives to export.');
      return;
    }
    const payload = {
      schema: 'decolog.v1',
      exportedAt: new Date().toISOString(),
      unitsPreference: units,
      dives,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `decolog-export-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    if (!dives.length) {
      alert('No dives to export.');
      return;
    }

    const header = [
      'id',
      'createdAt',
      'site',
      'depth_m',
      'time_min',
      'gas',
      'start_bar',
      'end_bar',
      'cyl_liters',
      'sac_l_per_min',
    ];

    const dateStr = new Date().toISOString();

    const lines = [
      '# DECOLOG - OFFLINE DIVE LOG HUD',
      `# export: ${dateStr}`,
      header.join(','),
      ...dives.map((d, index) =>
        [
          d.id ?? index + 1,
          d.createdAt,
          d.site,
          d.depth,
          d.time,
          d.gas,
          d.startPressure,
          d.endPressure,
          d.cylLiters,
          d.sac,
        ].map(csvCell).join(',')
      ),
    ];

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = dateStr.slice(0, 10);
    a.href = url;
    a.download = `decolog-export-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleExportPdf() {
    if (!dives.length) {
      alert('No dives to export.');
      return;
    }
    try {
      // @ts-ignore dynamic import
      const mod = await import('jspdf');
      const jsPDF = mod.default || mod.jsPDF;
      const doc = new jsPDF();

      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 210, 297, 'F');

      doc.setFont('courier', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0, 0, 0);
      doc.text('DECO', 14, 20);
      doc.setTextColor(0, 255, 156);
      doc.text('LOG', 44, 20);

      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text('OFFLINE DIVE LOG HUD', 14, 26);

      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Export summary', 14, 36);

      doc.setFontSize(9);
      const dateStr = new Date().toISOString();
      doc.text(`Dives: ${dives.length}`, 14, 42);
      doc.text(`Exported: ${dateStr}`, 14, 48);

      let y = 60;
      const lineHeight = 6;

      doc.setFontSize(9);
      doc.text('ID', 14, y);
      doc.text('SITE', 26, y);
      doc.text('DEPTH', 80, y);
      doc.text('TIME', 104, y);
      doc.text('GAS', 128, y);
      doc.text('SAC (L/min)', 152, y);

      y += lineHeight;

      dives.forEach((dive, index) => {
        const idStr = String(dive.id ?? index + 1);
        const site = dive.site ?? '';
        const depthStr = `${dive.depth} m`;
        const timeStr = `${dive.time} min`;
        const gasStr = dive.gas ?? '';
        const sacStr = dive.sac ? `${dive.sac.toFixed(1)}` : '—';

        doc.text(idStr, 14, y);
        doc.text(site.substring(0, 24), 26, y);
        doc.text(depthStr, 80, y);
        doc.text(timeStr, 104, y);
        doc.text(gasStr, 128, y);
        doc.text(sacStr, 152, y);

        y += lineHeight;
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
      });

      const date = dateStr.slice(0, 10);
      doc.save(`decolog-export-${date}.pdf`);
    } catch (err) {
      console.error(err);
      alert('PDF export module not available. Make sure "npm install jspdf" ran OK.');
    }
  }

  const totalDives = dives.length;
  const deepest = dives.length > 0 ? Math.max(...dives.map((d) => d.depth)) : 0;
  const avgSac =
    dives.length > 0
      ? dives.reduce((sum, d) => sum + (d.sac || 0), 0) / dives.length
      : 0;
  const totalTime = dives.reduce((sum, d) => sum + d.time, 0);
  const hours = Math.floor(totalTime / 60);
  const minutes = totalTime % 60;

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex justify-center text-[13px] mil-scan">
      <div className="w-full max-w-screen flex flex-col min-h-screen bg-black">
        <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-900">
          <div className="flex items-center gap-3">
            <img src="/decolog-logo.svg" className="h-10" />
          </div>
          <div className="flex items-center gap-4">
            <UnitToggle units={units} setUnits={setUnits} />
            <div className="font-mono text-[11px] mil-text">
              ● UPLINK: READY
            </div>
          </div>
        </header>

        <nav className="flex border-b border-zinc-700 bg-zinc-900">
          {(['log', 'stats', 'more'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] border-r border-zinc-700 last:border-r-0 ${
                tab === t
                  ? 'bg-black text-emerald-300'
                  : 'bg-zinc-900 text-zinc-400'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto px-3 pt-3 pb-16">
          {tab === 'log' && (
            <LogView
              dives={dives}
              loading={loading}
              isAdding={isAdding}
              units={units}
              newSite={newSite}
              newDepth={newDepth}
              newTime={newTime}
              newStart={newStart}
              newEnd={newEnd}
              newCyl={newCyl}
              gasMode={gasMode}
              o2Percent={o2Percent}
              ppO2Limit={ppO2Limit}
              editId={editId}
              cylProfile={cylProfile}
              setNewSite={setNewSite}
              setNewDepth={setNewDepth}
              setNewTime={setNewTime}
              setNewStart={setNewStart}
              setNewEnd={setNewEnd}
              setNewCyl={setNewCyl}
              setGasMode={setGasMode}
              setO2Percent={setO2Percent}
              setPpO2Limit={setPpO2Limit}
              setCylProfile={setCylProfile}
              onSave={handleSaveNewDive}
              onCancel={handleCancelNewDive}
              onNewDive={handleStartNewDive}
              onEditDive={handleEditDive}
              onDeleteDive={handleDeleteDive}
            />
          )}

          {tab === 'stats' && (
            <StatsView
              totalDives={totalDives}
              deepest={deepest}
              avgSac={avgSac}
              hours={hours}
              minutes={minutes}
              units={units}
            />
          )}

          {tab === 'more' && (
            <MoreView
              unlocked={unlocked}
              onUnlock={() => {
                setUnlocked(true);
                setUnlockedState(true);
              }}
              onExportJson={handleExportJson}
              onExportCsv={handleExportCsv}
              onExportPdf={handleExportPdf}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function UnitToggle({
  units,
  setUnits,
}: {
  units: Units;
  setUnits: (u: Units) => void;
}) {
  return (
    <div className="flex items-center gap-1 font-mono text-[11px]">
      <span className="text-zinc-500">UNITS</span>
      <button
        type="button"
        onClick={() => setUnits('metric')}
        className={`px-2 py-[2px] border border-zinc-600 ${
          units === 'metric'
            ? 'bg-emerald-700/40 text-emerald-300'
            : 'bg-black text-zinc-500'
        }`}
      >
        M
      </button>
      <button
        type="button"
        onClick={() => setUnits('imperial')}
        className={`px-2 py-[2px] border border-zinc-600 ${
          units === 'imperial'
            ? 'bg-emerald-700/40 text-emerald-300'
            : 'bg-black text-zinc-500'
        }`}
      >
        I
      </button>
    </div>
  );
}

function LogView(props: {
  dives: StoredDive[];
  loading: boolean;
  isAdding: boolean;
  units: Units;
  newSite: string;
  newDepth: string;
  newTime: string;
  newStart: string;
  newEnd: string;
  newCyl: string;
  gasMode: GasMode;
  o2Percent: string;
  ppO2Limit: string;
  editId: number | null;
  cylProfile: CylinderProfileId;
  setNewSite: (v: string) => void;
  setNewDepth: (v: string) => void;
  setNewTime: (v: string) => void;
  setNewStart: (v: string) => void;
  setNewEnd: (v: string) => void;
  setNewCyl: (v: string) => void;
  setGasMode: (v: GasMode) => void;
  setO2Percent: (v: string) => void;
  setPpO2Limit: (v: string) => void;
  setCylProfile: (id: CylinderProfileId) => void;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  onNewDive: () => void;
  onEditDive: (d: StoredDive) => void;
  onDeleteDive: (id?: number) => void;
}) {
  const {
    dives,
    loading,
    isAdding,
    units,
    newSite,
    newDepth,
    newTime,
    newStart,
    newEnd,
    newCyl,
    gasMode,
    o2Percent,
    ppO2Limit,
    editId,
    cylProfile,
    setNewSite,
    setNewDepth,
    setNewTime,
    setNewStart,
    setNewEnd,
    setNewCyl,
    setGasMode,
    setO2Percent,
    setPpO2Limit,
    setCylProfile,
    onSave,
    onCancel,
    onNewDive,
    onEditDive,
    onDeleteDive,
  } = props;

  function handleProfileChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value as CylinderProfileId;
    setCylProfile(id);
    const preset = CYL_PROFILES.find((p) => p.id === id);
    if (preset && preset.liters != null) {
      setNewCyl(preset.liters.toString());
    }
  }

  function handleCylInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewCyl(e.target.value);
    setCylProfile('CUSTOM');
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-mono text-zinc-500 uppercase tracking-[0.18em]">
          DIVE LOG
        </div>
        {!isAdding && (
          <button
            type="button"
            className="font-mono text-[11px] px-3 py-1 border border-emerald-500 text-emerald-300 rounded-md hover:bg-zinc-900 transition-colors"
            onClick={onNewDive}
          >
            + NEW DIVE
          </button>
        )}
      </div>

      {isAdding && (
        <form
          onSubmit={onSave}
          className="mb-3 p-3 border border-zinc-700 bg-zinc-900 space-y-2 mil-panel"
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono mil-dim uppercase tracking-[0.18em] mb-1">
              {editId != null ? 'EDIT DIVE' : 'NEW DIVE'}
            </div>
            {editId != null && (
              <div className="text-[10px] font-mono mil-dim">
                ID: #{editId}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Site
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newSite}
                onChange={(e) => setNewSite(e.target.value)}
                placeholder="BLUE HOLE"
              />
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Gas Mode
              </label>
              <select
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={gasMode}
                onChange={(e) => {
                  const v = e.target.value as GasMode;
                  setGasMode(v);
                  if (v === 'AIR') setO2Percent('21');
                }}
              >
                <option value="AIR">AIR</option>
                <option value="NITROX">NITROX</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                O₂ %
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={o2Percent}
                onChange={(e) => setO2Percent(e.target.value)}
                disabled={gasMode === 'AIR'}
              />
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                ppO₂ Limit
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={ppO2Limit}
                onChange={(e) => setPpO2Limit(e.target.value)}
                disabled={gasMode === 'AIR'}
              />
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                MOD
              </label>
              <div className="font-mono text-[13px] mil-text">
                {computeMOD(Number(o2Percent), Number(ppO2Limit), units)}
              </div>
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Depth (m)
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newDepth}
                onChange={(e) => setNewDepth(e.target.value)}
                placeholder="18"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Time (min)
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                placeholder="42"
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Start (bar)
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                placeholder="210"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                End (bar)
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                placeholder="70"
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Cylinder
              </label>
              <select
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={cylProfile}
                onChange={handleProfileChange}
              >
                {CYL_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] mil-dim uppercase block mb-1">
                Cyl (L)
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-[12px] font-mono"
                value={newCyl}
                onChange={handleCylInputChange}
                placeholder="11.1"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-1">
            {editId != null && (
              <button
                type="button"
                className="font-mono text-[10px] text-zinc-500 underline underline-offset-4"
                onClick={() => {
                  setNewSite('');
                  setNewDepth('18');
                  setNewTime('42');
                  setNewStart('210');
                  setNewEnd('70');
                  setNewCyl('11.1');
                  setGasMode('AIR');
                  setO2Percent('21');
                  setPpO2Limit('1.4');
                  setCylProfile('AL80');
                }}
              >
                CLEAR TO NEW
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                className="font-mono text-[11px] px-3 py-1 text-zinc-500"
                onClick={onCancel}
              >
                CANCEL
              </button>
              <button
                type="submit"
                className="font-mono text-[11px] px-3 py-1 border border-emerald-500 bg-emerald-500/10 text-emerald-300 rounded-md"
              >
                SAVE
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && (
        <div className="font-mono text-[12px] text-zinc-500">loading…</div>
      )}

      {!loading && dives.length === 0 && (
        <div className="font-mono text-[12px] text-zinc-500">
          no dives logged.
        </div>
      )}

      {!loading && dives.length > 0 && (
        <section className="space-y-3">
          {dives.map((dive, index) => (
            <article
              key={dive.id ?? dive.createdAt}
              className="mil-panel rounded-lg p-4 mb-2"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono tracking-[0.25em] mil-dim">
                  DIVE LOG ENTRY
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[11px] font-mono mil-dim">
                    #{dive.id ?? index + 1}
                  </div>
                  <button
                    type="button"
                    className="text-[10px] font-mono text-emerald-300 underline underline-offset-4"
                    onClick={() => onEditDive(dive)}
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    className="text-[10px] font-mono text-red-400 underline underline-offset-4"
                    onClick={() => onDeleteDive(dive.id)}
                  >
                    DELETE
                  </button>
                </div>
              </div>

              <div className="font-mono text-[15px] mb-3 mil-text">
                {dive.site}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
                <InfoBlock
                  label="Depth"
                  value={depthLabel(dive.depth, units)}
                />
                <InfoBlock label="Time" value={`${dive.time} min`} />
                <InfoBlock label="Gas" value={dive.gas} />
                <InfoBlock label="SAC" value={sacLabel(dive.sac, units)} accent />
                <InfoBlock
                  label="Start"
                  value={pressureLabel(dive.startPressure, units)}
                />
                <InfoBlock
                  label="End"
                  value={pressureLabel(dive.endPressure, units)}
                />
                <InfoBlock
                  label="Cyl"
                  value={cylLabel(dive.cylLiters, units)}
                />
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function InfoBlock({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] mil-dim">
        {label}
      </div>
      <div
        className={
          accent
            ? 'font-mono text-[14px] mil-text'
            : 'font-mono text-[14px]'
        }
      >
        {value}
      </div>
    </div>
  );
}

function StatsView(props: {
  totalDives: number;
  deepest: number;
  avgSac: number;
  hours: number;
  minutes: number;
  units: Units;
}) {
  const { totalDives, deepest, avgSac, hours, minutes, units } = props;

  return (
    <section className="mt-3 space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <div className="text-[10px] font-mono tracking-[0.25em] mil-dim uppercase">
          SYSTEM STATS
        </div>
        <div className="text-[10px] font-mono mil-dim">
          ENTRIES: {totalDives}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Dives" value={String(totalDives)} />
        <StatCard label="Avg SAC" value={sacLabel(avgSac, units)} />
        <StatCard
          label="Deepest Dive"
          value={depthLabel(deepest, units)}
        />
        <StatCard label="Total BT" value={`${hours}h ${minutes}m`} />
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="mil-panel rounded-lg p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] mil-dim mb-1">
        {label}
      </div>
      <div className="font-mono text-[18px] mil-text leading-tight">
        {value}
      </div>
    </div>
  );
}

function MoreView({
  unlocked,
  onUnlock,
  onExportJson,
  onExportCsv,
  onExportPdf,
}: {
  unlocked: boolean;
  onUnlock: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  return (
    <section className="more-shell">
      <div className="more-header-line">
        CONTROL / MORE MODULES
      </div>

      <div className="mil-panel rounded-lg p-3">
        <div className="text-[10px] font-mono tracking-[0.25em] mil-dim uppercase mb-2">
          SYSTEM MODULE
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="mil-dim">OFFLINE MODE</div>
          <div className="mil-text text-right">ACTIVE</div>

          <div className="mil-dim">CLOUD SYNC</div>
          <div className="text-right text-zinc-500">PENDING</div>

          <div className="mil-dim">BUILD</div>
          <div className="text-right text-zinc-500">LOCAL DEV</div>
        </div>
      </div>

      <div className="mil-panel rounded-lg p-3">
        <div className="text-[10px] font-mono tracking-[0.25em] mil-dim uppercase mb-2">
          LICENSE MODULE
        </div>

        <div className="text-[11px] font-mono mil-dim">
          TIER: OFFLINE FREE
        </div>

        {!unlocked ? (
          <button
            className="mt-3 w-full border border-emerald-500 text-emerald-300 px-3 py-2 font-mono text-[11px] tracking-[0.18em]"
            onClick={onUnlock}
          >
            UNLOCK MODULE
          </button>
        ) : (
          <div className="mt-3 font-mono text-[11px] text-emerald-400 tracking-[0.12em]">
            MODULE STATUS: ACTIVE
          </div>
        )}
      </div>

      <div className="mil-panel rounded-lg p-3">
        <div className="text-[10px] font-mono tracking-[0.25em] mil-dim uppercase mb-2">
          EXPORT MODULE
        </div>

        <div className="export-keys">
          <button
            className="export-key-btn border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
            onClick={onExportJson}
          >
            EXPORT JSON
          </button>

          <button
            className="export-key-btn border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
            onClick={onExportCsv}
          >
            EXPORT CSV
          </button>

          <button
            className="export-key-btn border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
            onClick={onExportPdf}
          >
            EXPORT PDF
          </button>
        </div>
      </div>
    </section>
  );
}
