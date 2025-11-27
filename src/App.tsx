import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import {
  seedIfEmpty,
  getDives,
  addDive,
  updateDive,
  deleteDive,
  type StoredDive,
  getProfile,
  saveProfile,
  saveSupportMessage,
  type SyncConfig,
  type ProfileInput,
  type SupportInput,
  getSyncConfig,
  saveSyncConfig,
} from './storage';
import { loadLicense, saveLicense, setLicenseMode, type LicenseState } from './state/license';
import { appBaseUrl, stripePriceCloud, stripePricePro, stripePublishableKey } from './config/stripe';

type Tab = 'log' | 'stats' | 'more';
type Gas = 'AIR' | 'EAN32';
type Units = 'metric' | 'imperial';

const FREE_LIMIT = 10;
const LICENSE_COPY =
  'Training: up to 10 dives on this device. Pro: unlimited local storage. Cloud Pro: sync (coming soon).';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function depthLabel(depthMeters: number, units: Units): string {
  if (!depthMeters) return units === 'imperial' ? '— ft' : '— m';
  if (units === 'imperial') {
    const ft = depthMeters * 3.28084;
    return `${ft.toFixed(0)} ft`;
  }
  return `${depthMeters.toFixed(0)} m`;
}

function sacLabel(sacLpm: number, units: Units): string {
  if (!sacLpm) return units === 'imperial' ? '— cu ft/min' : '— L/min';

  if (units === 'imperial') {
    const cuft = sacLpm / 28.317; // 1 cu ft ≈ 28.317 L
    return `${cuft.toFixed(2)} cu ft/min`;
  }
  return `${sacLpm.toFixed(1)} L/min`;
}

function pressureLabel(bar?: number, units: Units = 'metric'): string {
  if (bar == null || bar <= 0) return units === 'imperial' ? '— psi' : '— bar';
  if (units === 'imperial') {
    const psi = bar * 14.5038;
    return `${psi.toFixed(0)} psi`;
  }
  return `${bar.toFixed(0)} bar`;
}

function formatMinutes(min: number): string {
  if (!min || min <= 0) return '— min';
  return `${min.toFixed(0)} min`;
}

function formatTotalMinutes(min: number): string {
  if (!min || min <= 0) return '0 min';
  const hours = Math.floor(min / 60);
  const minutes = Math.round(min % 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function niceDate(d: string): string {
  if (!d) return '—';
  try {
    const obj = new Date(d);
    if (Number.isNaN(obj.getTime())) return d;
    return obj.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return d;
  }
}

// ---------------------------------------------------------------------
// Types for the dive form & profile
// ---------------------------------------------------------------------
interface DiveFormState {
  id?: number;
  date: string;
  site: string;
  location: string;
  depth: string; // meters as string
  time: string; // minutes as string
  gas: Gas;
  startBar: string;
  endBar: string;
  cylinderLiters: string;
  notes: string;
}

function emptyDiveForm(): DiveFormState {
  return {
    date: isoToday(),
    site: '',
    location: '',
    depth: '',
    time: '',
    gas: 'AIR',
    startBar: '',
    endBar: '',
    cylinderLiters: '11.1',
    notes: '',
  };
}

interface ProfileState {
  fullName: string;
  agency: string;
  certLevel: string;
  certNumber: string;
  country: string;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyNotes: string;
  notes: string;
}

function emptyProfile(): ProfileState {
  return {
    fullName: '',
    agency: '',
    certLevel: '',
    certNumber: '',
    country: '',
    email: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyNotes: '',
    notes: '',
  };
}

// ---------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------
export default function App() {
  async function handleCheckout(mode: 'pro' | 'cloud') {
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      const data = (await res.json()) as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Checkout session could not be created.');
      }

      window.location.href = data.url;
    } catch (error) {
      console.error('Checkout failed', error);
      alert('Checkout failed. Please try again or contact support.');
    }
  }

  const stripeEnvReady = Boolean(stripePublishableKey && stripePricePro && stripePriceCloud && appBaseUrl);
  const [tab, setTab] = useState<Tab>('log');
  const [dives, setDives] = useState<StoredDive[]>([]);
  const [loading, setLoading] = useState(true);

  const [units, setUnits] = useState<Units>(() => {
    if (typeof window === 'undefined') return 'metric';
    const stored = window.localStorage.getItem('decolog.units');
    return stored === 'imperial' ? 'imperial' : 'metric';
  });

  const [license, setLicense] = useState<LicenseState>(() => loadLicense());
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(() => getSyncConfig());
  const [syncing, setSyncing] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<'success' | 'cancel' | null>(null);

  const [form, setForm] = useState<DiveFormState>(emptyDiveForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingDive, setSavingDive] = useState(false);

  const [profile, setProfile] = useState<ProfileState>(emptyProfile());
  const [profileSaving, setProfileSaving] = useState(false);

  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportIncludeDevice, setSupportIncludeDevice] = useState(true);
  const [supportSaving, setSupportSaving] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showEmergencyCard, setShowEmergencyCard] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // seed + load dives on first mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      await seedIfEmpty();
      const list = await getDives();
      if (!cancelled) {
        // newest first
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setDives(list);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // load profile
  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      const stored = await getProfile();
      if (!cancelled && stored) {
        const mapped: ProfileState = {
          fullName: stored.fullName,
          agency: stored.agency,
          certLevel: stored.certLevel,
          certNumber: stored.certNumber,
          country: stored.country,
          email: stored.email,
          emergencyContactName: stored.emergencyContactName,
          emergencyContactPhone: stored.emergencyContactPhone,
          emergencyNotes: stored.emergencyNotes,
          notes: stored.notes,
        };
        setProfile(mapped);
      }
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // persist units
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('decolog.units', units);
    }
  }, [units]);

  useEffect(() => {
    saveLicense(license);
  }, [license]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const mode = params.get('mode');
    const normalizedMode = mode === 'pro' || mode === 'cloud' ? mode : null;

    if (checkout === 'success' && normalizedMode) {
      setLicense((prev) => setLicenseMode(normalizedMode, prev));
      setCheckoutStatus('success');
    } else if (checkout === 'cancel') {
      setCheckoutStatus('cancel');
    }

    if (checkout) {
      params.delete('checkout');
      params.delete('mode');
      params.delete('session_id');
      const nextSearch = params.toString();
      const nextUrl = nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  const isTraining = license.mode === 'training';
  const isPro = license.mode === 'pro' || license.mode === 'cloud';
  const hasCloudSync = license.mode === 'cloud';

  const canAddDive = isTraining ? dives.length < FREE_LIMIT : true;

  // stats
  const stats = useMemo(() => {
    if (!dives.length) {
      return {
        count: 0,
        totalMinutes: 0,
        maxDepth: 0,
        avgSac: 0,
        divesByGas: { AIR: 0, EAN32: 0 } as Record<Gas, number>,
      };
    }

    let totalMinutes = 0;
    let maxDepth = 0;
    let totalSac = 0;
    let sacCount = 0;
    const divesByGas: Record<Gas, number> = { AIR: 0, EAN32: 0 };

    for (const d of dives) {
      totalMinutes += d.bottomTimeMin || 0;
      if (d.depthMeters > maxDepth) maxDepth = d.depthMeters;
      if (d.sacLpm) {
        totalSac += d.sacLpm;
        sacCount += 1;
      }
      if (d.gas === 'AIR' || d.gas === 'EAN32') {
        divesByGas[d.gas] += 1;
      }
    }

    const avgSac = sacCount > 0 ? totalSac / sacCount : 0;

    return {
      count: dives.length,
      totalMinutes,
      maxDepth,
      avgSac,
      divesByGas,
    };
  }, [dives]);

  const deviceInfo = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return 'Unknown device';
    }
    const ua = navigator.userAgent;
    const size = `${window.innerWidth}x${window.innerHeight}`;
    return `${ua} | ${size}`;
  }, []);

  // -------------------------------------------------------------------
  // Dive form handlers
  // -------------------------------------------------------------------
  function handleFormChange<K extends keyof DiveFormState>(key: K, value: DiveFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveDive() {
    if (savingDive) return;
    setSavingDive(true);
    try {
      const depth = Number(form.depth) || 0;
      const time = Number(form.time) || 0;
      const startP = Number(form.startBar) || 0;
      const endP = Number(form.endBar) || 0;
      const cyl = Number(form.cylinderLiters) || 11.1;

      let sacLpm = 0;
      if (depth > 0 && time > 0 && startP > 0 && endP > 0 && startP > endP) {
        const barUsed = startP - endP;
        const gasUsedLiters = barUsed * cyl;
        const ambient = depth / 10 + 1; // rough
        const rmv = gasUsedLiters / time;
        sacLpm = rmv / ambient;
      }

      const payload = {
        date: form.date || isoToday(),
        site: form.site.trim() || 'UNNAMED SITE',
        location: form.location.trim() || '—',
        depthMeters: depth,
        bottomTimeMin: time,
        gas: form.gas,
        sacLpm,
        startBar: startP || undefined,
        endBar: endP || undefined,
        cylinderLiters: cyl || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (editingId != null) {
        await updateDive(editingId, payload);
        setDives((prev) =>
          prev.map((d) => (d.id === editingId ? { ...d, ...payload, updatedAt: Date.now() } : d)),
        );
      } else {
        if (!canAddDive) {
          setSavingDive(false);
          return;
        }
        const saved = await addDive(payload);
        setDives((prev) => {
          const list = [saved, ...prev];
          list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          return list;
        });
      }

      setForm(emptyDiveForm());
      setEditingId(null);
    } finally {
      setSavingDive(false);
    }
  }

  function handleEditDive(dive: StoredDive) {
    setEditingId(dive.id ?? null);
    setForm({
      id: dive.id,
      date: dive.date,
      site: dive.site,
      location: dive.location ?? '',
      depth: dive.depthMeters ? String(dive.depthMeters) : '',
      time: dive.bottomTimeMin ? String(dive.bottomTimeMin) : '',
      gas: dive.gas === 'EAN32' ? 'EAN32' : 'AIR',
      startBar: dive.startBar != null ? String(dive.startBar) : '',
      endBar: dive.endBar != null ? String(dive.endBar) : '',
      cylinderLiters: dive.cylinderLiters != null ? String(dive.cylinderLiters) : '11.1',
      notes: dive.notes ?? '',
    });
  }

  async function handleDeleteDive(id?: number) {
    if (id == null) return;
    await deleteDive(id);
    setDives((prev) => prev.filter((d) => d.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setForm(emptyDiveForm());
    }
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(emptyDiveForm());
  }

  // -------------------------------------------------------------------
  // Profile handlers
  // -------------------------------------------------------------------
  async function handleSaveProfile() {
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const payload: ProfileInput = {
        fullName: profile.fullName.trim(),
        agency: profile.agency.trim(),
        certLevel: profile.certLevel.trim(),
        certNumber: profile.certNumber.trim(),
        country: profile.country.trim(),
        email: profile.email.trim(),
        emergencyContactName: profile.emergencyContactName.trim(),
        emergencyContactPhone: profile.emergencyContactPhone.trim(),
        emergencyNotes: profile.emergencyNotes.trim(),
        notes: profile.notes.trim(),
      };
      await saveProfile(payload);
    } finally {
      setProfileSaving(false);
    }
  }

  // -------------------------------------------------------------------
  // Support handlers
  // -------------------------------------------------------------------
  async function handleSaveSupport() {
    if (supportSaving) return;
    if (!supportSubject.trim() && !supportMessage.trim()) return;

    setSupportSaving(true);
    try {
      const payload: SupportInput = {
        subject: supportSubject.trim() || '(no subject)',
        message: supportMessage.trim() || '(empty message)',
        includeDevice: supportIncludeDevice,
        deviceInfo: supportIncludeDevice ? deviceInfo : undefined,
      };
      await saveSupportMessage(payload);
      setSupportSubject('');
      setSupportMessage('');
    } finally {
      setSupportSaving(false);
    }
  }

  function handleToggleCloudSync(enabled: boolean) {
    if (!hasCloudSync) return;
    const next = { ...syncConfig, cloudSyncEnabled: enabled };
    setSyncConfig(next);
    saveSyncConfig(next);
  }

  function handleManualSync() {
    if (syncing || !syncConfig.cloudSyncEnabled || !hasCloudSync) return;
    setSyncing(true);
    const pending = { ...syncConfig, lastSyncStatus: 'idle' as const };
    setSyncConfig(pending);
    setTimeout(() => {
      console.log('DecoLog dev sync stub: would sync dives and support messages');
      const next = { ...pending, lastSyncAt: Date.now(), lastSyncStatus: 'ok' as const };
      setSyncConfig(next);
      saveSyncConfig(next);
      setSyncing(false);
    }, 1000);
  }

  // -------------------------------------------------------------------
  // Export handlers
  // -------------------------------------------------------------------
  function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJson() {
    const payload = {
      meta: {
        app: 'Dive Ops HUD',
        exportedAt: new Date().toISOString(),
        count: dives.length,
      },
      dives,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(`decolog-export-${stamp}.json`, blob);
  }

  function handleExportCsv() {
    const header = [
      'id',
      'date',
      'site',
      'location',
      'depth_m',
      'bottom_time_min',
      'gas',
      'sac_L_min',
      'start_bar',
      'end_bar',
      'cylinder_L',
      'notes',
    ];
    const lines = [header.join(',')];

    for (const d of dives) {
      const row = [
        d.id ?? '',
        d.date,
        `"${(d.site || '').replace(/"/g, '""')}"`,
        `"${(d.location || '').replace(/"/g, '""')}"`,
        d.depthMeters ?? '',
        d.bottomTimeMin ?? '',
        d.gas,
        d.sacLpm ?? '',
        d.startBar ?? '',
        d.endBar ?? '',
        d.cylinderLiters ?? '',
        `"${(d.notes || '').replace(/"/g, '""')}"`,
      ];
      lines.push(row.join(','));
    }

    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(`decolog-export-${stamp}.csv`, blob);
  }

  function handleExportPdf() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let y = 15;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('DIVE OPS HUD // OFFLINE MISSION LOG', 14, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 14, y);
    y += 8;

    if (!dives.length) {
      doc.text('No dives logged.', 14, y);
      doc.save('decolog-export.pdf');
      return;
    }

    const lineHeight = 5;
    const maxY = 280;

    for (const d of dives) {
      if (y > maxY) {
        doc.addPage();
        y = 15;
      }

      doc.setFont('helvetica', 'bold');
      doc.text(
        `${niceDate(d.date)}  //  ${d.site || 'UNNAMED SITE'} (${d.location || '—'})`,
        14,
        y,
      );
      y += lineHeight;

      doc.setFont('helvetica', 'normal');

      doc.text(
        `Depth: ${depthLabel(d.depthMeters, units)}   BT: ${formatMinutes(
          d.bottomTimeMin,
        )}   Gas: ${d.gas}`,
        14,
        y,
      );
      y += lineHeight;

      doc.text(
        `SAC: ${sacLabel(d.sacLpm ?? 0, units)}   Pressure: ${pressureLabel(
          d.startBar,
          units,
        )} → ${pressureLabel(d.endBar, units)}   Cyl: ${
          d.cylinderLiters ? `${d.cylinderLiters.toFixed?.(1) ?? d.cylinderLiters} L` : '—'
        }`,
        14,
        y,
      );
      y += lineHeight;

      if (d.notes) {
        const split = doc.splitTextToSize(`Notes: ${d.notes}`, 180);
        doc.text(split, 14, y);
        y += lineHeight * (split.length || 1);
      }

      y += lineHeight; // extra gap
    }

    doc.save('decolog-export.pdf');
  }

  // -------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------
  function renderHeader() {
    const unitsLabel = units === 'imperial' ? 'IMPERIAL' : 'METRIC';

    return (
      <header className="hud-header mb-5">
        <div className="hud-strip rounded-lg border border-emerald-500/30 bg-zinc-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src="/decolog-logo.svg" alt="DECOLOG emblem" className="hud-mark h-8 w-auto" />
              <div className="font-mono text-sm uppercase tracking-[0.25em] text-emerald-200">
                DECOLOG
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-200">
              <span>UPLINK: READY</span>
              <span aria-hidden className="text-emerald-400">●</span>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="hud-status flex flex-wrap items-center gap-2 rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-200">
              <span>CHANNEL: TRAINING</span>
              <span className="text-emerald-400">|</span>
              <span>UNITS: {unitsLabel}</span>
              <span className="text-emerald-400">|</span>
              <span>CONSOLE: LIVE</span>
            </div>

            <div className="hud-controls flex flex-wrap items-center gap-4">
              <div className="hud-units flex items-center gap-2">
                <span className="hud-label">UNITS</span>
                <button
                  type="button"
                  onClick={() => setUnits('metric')}
                  className={`rounded border px-2 py-1 ${units === 'metric' ? 'is-active' : ''}`}
                >
                  METRIC
                </button>
                <button
                  type="button"
                  onClick={() => setUnits('imperial')}
                  className={`rounded border px-2 py-1 ${units === 'imperial' ? 'is-active' : ''}`}
                >
                  IMPERIAL
                </button>
              </div>
              <div className="hud-license text-left md:text-right">
                <span className="hud-mode">
                  MODE //{' '}
                  {isPro
                    ? hasCloudSync
                      ? 'CLOUD PRO // PROTOCOL OPEN'
                      : 'PRO // PROTOCOL OPEN'
                    : 'TRAINING CHANNEL'}
                </span>
                <span className="hud-tier">{LICENSE_COPY}</span>
              </div>
            </div>
          </div>
        </div>
      </header>
    );
  }

  function renderTabs() {
    return (
      <div className="hud-tabs mb-4">
        <div className="hud-tabs-bar flex items-stretch gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
          {(['log', 'stats', 'more'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`hud-tab flex-1 rounded border px-2 py-1.5 ${tab === t ? 'is-active' : ''}`}
            >
              {t === 'log' && 'LOG'}
              {t === 'stats' && 'STATS'}
              {t === 'more' && 'MORE'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderLogTab() {
    return (
      <section className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* New / edit form */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            {editingId != null ? 'EDIT DIVE' : 'NEW DIVE'}
          </div>

          {!canAddDive && editingId == null && (
            <div className="mb-3 rounded border border-amber-500/50 bg-amber-500/10 p-2 font-mono text-[10px] text-amber-300">
              {LICENSE_COPY} Free tier limit reached.
            </div>
          )}

          <div className="grid gap-2 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Date
                </span>
                <input
                  type="date"
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.date}
                  onChange={(e) => handleFormChange('date', e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Location
                </span>
                <input
                  type="text"
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.location}
                  onChange={(e) => handleFormChange('location', e.target.value)}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Site name
              </span>
              <input
                type="text"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={form.site}
                onChange={(e) => handleFormChange('site', e.target.value)}
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Max depth (m)
                </span>
                <input
                  type="number"
                  min={0}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.depth}
                  onChange={(e) => handleFormChange('depth', e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Bottom time (min)
                </span>
                <input
                  type="number"
                  min={0}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.time}
                  onChange={(e) => handleFormChange('time', e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Cylinder (L)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.cylinderLiters}
                  onChange={(e) => handleFormChange('cylinderLiters', e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Start (bar)
                </span>
                <input
                  type="number"
                  min={0}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.startBar}
                  onChange={(e) => handleFormChange('startBar', e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  End (bar)
                </span>
                <input
                  type="number"
                  min={0}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  value={form.endBar}
                  onChange={(e) => handleFormChange('endBar', e.target.value)}
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Gas
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleFormChange('gas', 'AIR')}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      form.gas === 'AIR'
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                        : 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    AIR
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormChange('gas', 'EAN32')}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      form.gas === 'EAN32'
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                        : 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    EAN32
                  </button>
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Notes
              </span>
              <textarea
                rows={3}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={form.notes}
                onChange={(e) => handleFormChange('notes', e.target.value)}
              />
            </label>

            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={savingDive || (!canAddDive && editingId == null)}
                onClick={handleSaveDive}
                className="flex-1 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200 disabled:opacity-60"
              >
                {editingId != null ? 'UPDATE DIVE' : 'LOG DIVE'}
              </button>
              {editingId != null && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300"
                >
                  CANCEL
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dive list */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              DIVE LOG
            </div>
            <div className="font-mono text-[10px] text-zinc-500 tracking-[0.18em]">
              TOTAL: {dives.length}
            </div>
          </div>

          {loading && (
            <div className="py-6 text-center font-mono text-[11px] text-zinc-500 tracking-[0.18em]">
              LOADING DIVE DATA…
            </div>
          )}

          {!loading && !dives.length && (
            <div className="py-6 text-center font-mono text-[11px] text-zinc-500 tracking-[0.18em]">
              NO DIVES LOGGED YET.
            </div>
          )}

          <div className="flex flex-col gap-2">
            {dives.map((d) => (
              <div key={d.id} className="hud-subpanel rounded border px-3 py-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] tracking-[0.18em] text-zinc-300">
                    {niceDate(d.date)} // {d.site || 'UNNAMED SITE'}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {d.location || '—'}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-400">
                  <span>DEPTH {depthLabel(d.depthMeters, units)}</span>
                  <span>BT {formatMinutes(d.bottomTimeMin)}</span>
                  <span>GAS {d.gas}</span>
                  <span>SAC {sacLabel(d.sacLpm ?? 0, units)}</span>
                </div>

                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
                  <span>
                    PRESS {pressureLabel(d.startBar, units)} → {pressureLabel(d.endBar, units)}
                  </span>
                  <span>
                    CYL{' '}
                    {d.cylinderLiters
                      ? `${d.cylinderLiters.toFixed?.(1) ?? d.cylinderLiters} L`
                      : '—'}
                  </span>
                </div>

                {d.notes && (
                  <div className="mt-1 font-mono text-[10px] text-zinc-400">
                    NOTES: {d.notes}
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditDive(d)}
                    className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300"
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteDive(d.id)}
                    className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-red-300"
                  >
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderStatsTab() {
    return (
      <section className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          STATS MODULE
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="hud-subpanel rounded border p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              TOTAL DIVES
            </div>
            <div className="mt-1 font-mono text-xl tracking-[0.15em] text-emerald-300">
              {stats.count}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-500">
              BOTTOM TIME {formatTotalMinutes(stats.totalMinutes)}
            </div>
          </div>

          <div className="hud-subpanel rounded border p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              DEPTH / GAS
            </div>
            <div className="mt-1 font-mono text-[13px] text-zinc-200">
              MAX {depthLabel(stats.maxDepth, units)}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-500">
              AIR: {stats.divesByGas.AIR} | EAN32: {stats.divesByGas.EAN32}
            </div>
          </div>

          <div className="hud-subpanel rounded border p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              SAC
            </div>
            <div className="mt-1 font-mono text-[13px] text-zinc-200">
              AVG {sacLabel(stats.avgSac, units)}
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-500">
              Metric baseline stored internally
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderMoreTab() {
    const currentModeLabel =
      license.mode === 'training' ? 'Training' : license.mode === 'cloud' ? 'Cloud Pro' : 'Pro';
    const proDisabled = license.mode !== 'training' || !stripeEnvReady;
    const cloudDisabled = license.mode === 'cloud' || !stripeEnvReady;
    const modeDescription =
      license.mode === 'cloud'
        ? 'Cloud Pro: unlimited local dives + cloud backup & sync across devices.'
        : license.mode === 'pro'
          ? 'Pro: unlimited local dives on this device. No sync.'
          : 'Training: up to 10 dives stored on this device. Great for tryouts & courses.';
    const profileName = profile.fullName?.trim() || 'Not set';
    const profileSummary =
      [profile.country, profile.agency, profile.certLevel].filter(Boolean).join(' / ') || 'Not set';
    const emergencySummary =
      profile.emergencyContactName || profile.emergencyContactPhone
        ? `${profile.emergencyContactName || 'Name not set'} – ${profile.emergencyContactPhone || 'Phone not set'}`
        : 'Not set';
    const envLabel = (import.meta.env.MODE || 'dev').toUpperCase();
    const buildInfo = { version: 'v0.x.x', hash: 'dev-build', env: envLabel };

    const handleDevUnlock = (mode: 'pro' | 'cloud') => {
      setLicense((prev) => setLicenseMode(mode, prev));
    };

    const handleDumpLocalStorage = () => {
      if (typeof window === 'undefined') return;
      const snapshot: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key) {
          snapshot[key] = window.localStorage.getItem(key) ?? '';
        }
      }
      console.log('DecoLog localStorage snapshot', snapshot);
    };

    const handleResetLocalData = () => {
      console.log('DecoLog reset stub: hook up Dexie clearing here if needed.');
    };

    return (
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            MORE // SYSTEM
          </div>
          <div className="font-mono text-[10px] text-zinc-500">Device, license, export, and support tools.</div>
        </div>

        {/* License & plans */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            LICENSE & PLANS
          </div>

          {!stripeEnvReady && (
            <div className="mb-3 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 font-mono text-[10px] text-amber-200 tracking-[0.16em]">
              Stripe config missing (publishable key / price IDs). Buttons disabled until set.
            </div>
          )}

          {checkoutStatus === 'success' && (
            <div className="mb-3 rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-[10px] text-emerald-200 tracking-[0.16em]">
              Checkout complete — license updated.
            </div>
          )}

          {checkoutStatus === 'cancel' && (
            <div className="mb-3 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 font-mono text-[10px] text-amber-200 tracking-[0.16em]">
              Checkout canceled. No changes made.
            </div>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200">
                MODE: {currentModeLabel.toUpperCase()}
              </div>
              <div className="text-[13px] text-zinc-200">{modeDescription}</div>
            </div>
            <div className="font-mono text-[10px] text-zinc-500 md:text-right">
              <div>Training limit: up to {FREE_LIMIT} dives on this device.</div>
              <div>
                {license.activatedAt
                  ? `Activated: ${new Date(license.activatedAt).toLocaleString()}`
                  : 'Activation pending while in training.'}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1 font-mono text-[10px] text-zinc-300 tracking-[0.18em]">
            <div>• TRAINING – up to 10 local dives</div>
            <div>• PRO – unlimited local storage</div>
            <div>• CLOUD PRO – sync, backup, and multi-device access</div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {license.mode === 'training' && (
              <>
                <button
                  type="button"
                  disabled={proDisabled}
                  onClick={() => handleCheckout('pro')}
                  className={`rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ${
                    proDisabled
                      ? 'border-zinc-700 text-zinc-500'
                      : 'bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  Upgrade to Pro
                </button>
                <button
                  type="button"
                  disabled={cloudDisabled}
                  onClick={() => handleCheckout('cloud')}
                  className={`rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ${
                    cloudDisabled ? 'border-zinc-700 text-zinc-500' : 'bg-sky-500/10 text-sky-200'
                  }`}
                >
                  Go Cloud Pro
                </button>
              </>
            )}
            {license.mode === 'pro' && (
              <button
                type="button"
                disabled={cloudDisabled}
                onClick={() => handleCheckout('cloud')}
                className={`rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ${
                  cloudDisabled ? 'border-zinc-700 text-zinc-500' : 'bg-sky-500/10 text-sky-200'
                }`}
              >
                Go Cloud Pro
              </button>
            )}
            {license.mode === 'cloud' && (
              <button
                type="button"
                disabled
                className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400"
              >
                Cloud Pro Active
              </button>
            )}
          </div>
        </div>

        {/* Cloud & sync */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            CLOUD & SYNC
          </div>
          {!hasCloudSync && (
            <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[10px] text-amber-200 tracking-[0.14em]">
              Cloud sync will be available once your Cloud Pro license is active.
            </div>
          )}
          <div className="grid gap-3 text-[13px]">
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              <input
                type="checkbox"
                className="h-3 w-3 border border-zinc-600 bg-zinc-900 accent-emerald-500"
                checked={syncConfig.cloudSyncEnabled}
                disabled={!hasCloudSync}
                onChange={(e) => handleToggleCloudSync(e.target.checked)}
              />
              Enable cloud sync (Cloud Pro)
            </label>
            <div className="font-mono text-[10px] text-zinc-500">
              Status: {syncConfig.lastSyncStatus.toUpperCase()} {syncing ? '(running...)' : ''}
            </div>
            <div className="font-mono text-[10px] text-zinc-500">
              Last sync:{' '}
              {syncConfig.lastSyncAt ? new Date(syncConfig.lastSyncAt).toLocaleString() : 'never'}
            </div>
            <button
              type="button"
              disabled={!syncConfig.cloudSyncEnabled || syncing || !hasCloudSync}
              onClick={handleManualSync}
              className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200 disabled:border-zinc-700 disabled:text-zinc-500"
            >
              SYNC NOW
            </button>
            <div className="font-mono text-[10px] text-zinc-500">
              Note: For now this is local-only wiring. Full cloud sync will come in a later version.
            </div>
          </div>
        </div>

        {/* Data export */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            DATA EXPORT
          </div>
          <div className="text-[13px] text-zinc-200">
            Export your dive logs for backups, audits, or sharing with instructors.
          </div>
          <div className="mt-3 export-keys flex flex-wrap gap-2">
            <button
              className="export-key-btn rounded border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
              onClick={handleExportJson}
            >
              EXPORT JSON
            </button>
            <button
              className="export-key-btn rounded border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
              onClick={handleExportCsv}
            >
              EXPORT CSV
            </button>
            <button
              className="export-key-btn rounded border border-zinc-600 text-zinc-200 px-3 py-2 font-mono text-[11px] tracking-[0.12em] hover:bg-zinc-800"
              onClick={handleExportPdf}
            >
              EXPORT PDF
            </button>
          </div>
          <div className="mt-3 font-mono text-[10px] text-zinc-500">
            Exports use only the logs stored on this device.
          </div>
        </div>

        {/* Diver profile & emergency */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            DIVER PROFILE & EMERGENCY
          </div>
          <div className="space-y-2 text-[13px]">
            <div className="font-mono text-[10px] text-zinc-400">Name</div>
            <div className="font-mono text-[13px] text-zinc-200">{profileName}</div>
            <div className="font-mono text-[10px] text-zinc-400">Country / Agency / Level</div>
            <div className="font-mono text-[13px] text-zinc-200">{profileSummary}</div>
            <div className="font-mono text-[10px] text-zinc-400">Emergency contact</div>
            <div className="font-mono text-[13px] text-zinc-200">{emergencySummary}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowProfileEditor((prev) => !prev)}
              className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200"
            >
              {showProfileEditor ? 'Close Profile Editor' : 'Edit Profile'}
            </button>
            <button
              type="button"
              onClick={() => setShowEmergencyCard((prev) => !prev)}
              className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200"
            >
              {showEmergencyCard ? 'Hide Emergency Card' : 'Show Emergency Card'}
            </button>
          </div>
          <div className="mt-3 font-mono text-[10px] text-zinc-500">
            Profile stays on this device. Cloud syncing of profile will arrive with Cloud Pro.
          </div>

          {showEmergencyCard && (
            <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                EMERGENCY CARD
              </div>
              <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-200">
                <div>Contact: {emergencySummary}</div>
                <div>Notes: {profile.emergencyNotes || 'Not set'}</div>
                <div>Additional: {profile.notes || 'Not set'}</div>
              </div>
            </div>
          )}

          {showProfileEditor && (
            <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                EDIT PROFILE
              </div>
              <div className="grid gap-2 md:grid-cols-2 text-[13px]">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Full name
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.fullName}
                    onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Country
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.country}
                    onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Agency
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.agency}
                    onChange={(e) => setProfile((p) => ({ ...p, agency: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Certification level
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.certLevel}
                    onChange={(e) => setProfile((p) => ({ ...p, certLevel: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Certification number
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.certNumber}
                    onChange={(e) => setProfile((p) => ({ ...p, certNumber: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Email
                  </span>
                  <input
                    type="email"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.email}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Emergency contact name
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.emergencyContactName}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, emergencyContactName: e.target.value }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Emergency contact phone
                  </span>
                  <input
                    type="text"
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.emergencyContactPhone}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, emergencyContactPhone: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Emergency notes
                  </span>
                  <textarea
                    rows={3}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.emergencyNotes}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, emergencyNotes: e.target.value }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    Additional notes
                  </span>
                  <textarea
                    rows={3}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                    value={profile.notes}
                    onChange={(e) => setProfile((p) => ({ ...p, notes: e.target.value }))}
                  />
                </label>
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={profileSaving}
                  onClick={handleSaveProfile}
                  className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200 disabled:border-zinc-700 disabled:text-zinc-500"
                >
                  SAVE PROFILE
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Support & feedback */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            SUPPORT & FEEDBACK
          </div>

          <div className="grid gap-2 text-[13px]">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Subject
              </span>
              <input
                type="text"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={supportSubject}
                onChange={(e) => setSupportSubject(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Message
              </span>
              <textarea
                rows={4}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
              />
            </label>

            <label className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-400">
              <input
                type="checkbox"
                className="h-3 w-3 border border-zinc-600 bg-zinc-900 accent-emerald-500"
                checked={supportIncludeDevice}
                onChange={(e) => setSupportIncludeDevice(e.target.checked)}
              />
              Include anonymous device info (helps debugging)
            </label>

            <div className="mt-1 flex items-center justify-between">
              <div className="max-w-md font-mono text-[9px] text-zinc-500">
                Messages are stored locally in this HUD for now. Outbound send will be wired in a
                future update.
              </div>
              <button
                type="button"
                disabled={supportSaving}
                onClick={handleSaveSupport}
                className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200 disabled:border-zinc-700 disabled:text-zinc-500"
              >
                SAVE MESSAGE
              </button>
            </div>
          </div>
        </div>

        {/* Developer / diagnostics */}
        <div className="mil-panel rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              DEVELOPER / DIAGNOSTICS
            </div>
            <button
              type="button"
              onClick={() => setShowDiagnostics((prev) => !prev)}
              className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200"
            >
              {showDiagnostics ? 'Close' : 'Open'}
            </button>
          </div>
          {showDiagnostics && (
            <div className="space-y-3 text-[13px]">
              <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  Dev payment stubs
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleDevUnlock('pro')}
                    className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-200"
                  >
                    Unlock Pro (dev stub)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDevUnlock('cloud')}
                    className="rounded border border-sky-500 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-sky-200"
                  >
                    Unlock Cloud (dev stub)
                  </button>
                </div>
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  Storage & reset
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDumpLocalStorage}
                    className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200"
                  >
                    Dump local storage to console
                  </button>
                  <button
                    type="button"
                    onClick={handleResetLocalData}
                    className="rounded border border-red-500 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-red-200"
                  >
                    Reset local data (danger)
                  </button>
                </div>
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  Build info
                </div>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-200">
                  <div>Version: {buildInfo.version}</div>
                  <div>Build: {buildInfo.hash}</div>
                  <div>Environment: {buildInfo.env}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------
  return (
    <div className="app-frame min-h-screen text-zinc-100">
      <main className="mx-auto max-w-5xl space-y-5 px-3 py-5 md:space-y-6 md:py-7">
        {renderHeader()}
        {renderTabs()}
        {tab === 'log' && renderLogTab()}
        {tab === 'stats' && renderStatsTab()}
        {tab === 'more' && renderMoreTab()}
      </main>
    </div>
  );
}
