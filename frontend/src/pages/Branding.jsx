import { useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { brandStyle, FONTS } from '../theme/brand';
import { Alert, Field, PageTitle } from '../components/ui';
import { Icon } from '../components/icons';
import { Modal } from '../components/crud';

const CATEGORIES = [['premium', 'Premium'], ['countries', 'Countries'], ['edificios', 'Edificios'], ['barrios', 'Barrios'], ['amenities', 'Amenities']];
const ACCEPT = { logo: 'image/png,image/jpeg,image/webp,image/svg+xml', cover: 'image/png,image/jpeg,image/webp,image/avif', video: 'video/mp4,video/webm', image: 'image/png,image/jpeg,image/webp,image/avif' };
const LIMIT_MB = { logo: 2, cover: 10, video: 50, image: 10 };

/** Publica el branding nuevo para que el panel lo aplique sin recargar. */
const broadcast = (data) => window.dispatchEvent(new CustomEvent('branding:updated', { detail: data }));

function Preview({ s }) {
  return (
    <div style={brandStyle(s)} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
      <div className="relative h-28 bg-brand-800">
        {s.cover_url && <img src={s.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 to-transparent" />
        <div className="absolute bottom-3 left-4 flex items-center gap-2">
          {s.logo_url && <img src={s.logo_url} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />}
          <span className="font-display text-lg font-bold text-white">{s.display_name || 'Mi complejo'}</span>
        </div>
      </div>
      <div className="space-y-3 bg-white p-4 dark:bg-slate-900">
        <p className="font-sans text-sm text-slate-600 dark:text-slate-300">{s.tagline || 'Así se ven los botones y textos con esta identidad.'}</p>
        <div className="flex flex-wrap gap-2">
          <span className="btn-primary pointer-events-none">Botón principal</span>
          <span className="btn pointer-events-none bg-accent text-white">Acento</span>
          <span className="badge bg-brand-100 text-brand-800">Etiqueta</span>
        </div>
      </div>
    </div>
  );
}

function UploadSlot({ kind, label, url, onUpload, onRemove, busy }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-slate-500">máx. {LIMIT_MB[kind]} MB</span>
      </div>
      <div className="grid aspect-video place-items-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
        {url ? (kind === 'video'
          ? <video src={url} controls preload="metadata" className="h-full w-full" />
          : <img src={url} alt={label} className={`h-full w-full ${kind === 'logo' ? 'object-contain p-4' : 'object-cover'}`} />)
          : <Icon name={kind === 'video' ? 'play' : 'upload'} className="h-8 w-8 text-slate-400" />}
      </div>
      <div className="flex gap-2">
        <label className={`btn-secondary flex-1 cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <Icon name="upload" className="h-4 w-4" />{url ? 'Reemplazar' : 'Subir'}
          <input type="file" accept={ACCEPT[kind]} className="sr-only" disabled={busy}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { onUpload(kind, f); } }} />
        </label>
        {url && <button type="button" className="btn-secondary text-red-600" onClick={() => onRemove(kind)} aria-label={`Quitar ${label}`}><Icon name="trash" className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

export default function Branding() {
  const [data, setData] = useState(null);
  const [themes, setThemes] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState({});
  const [progress, setProgress] = useState(null); // { kind, pct }
  const [category, setCategory] = useState('premium');
  const [confirmDel, setConfirmDel] = useState(null);

  const load = (d) => {
    setData(d);
    const c = d.settings.custom;
    setForm({
      theme_id: d.settings.theme_id, display_name: d.settings.display_name, tagline: d.settings.tagline || '',
      description: d.settings.description || '', primary_color: c.primary_color, accent_color: c.accent_color,
      font_display: c.font_display, font_body: c.font_body, video_url: d.settings.video_external || '', public_enabled: d.settings.public_enabled,
    });
    broadcast(d);
  };

  useEffect(() => {
    api.get('/branding').then((r) => load(r.data)).catch((e) => setMsg({ error: errMsg(e) }));
    api.get('/public/themes').then((r) => setThemes(r.data.themes));
  }, []);

  if (!form) { return msg.error ? <Alert msg={msg.error} /> : <p className="text-slate-500">Cargando…</p>; }

  const theme = themes.find((t) => t.id === form.theme_id);
  // Vista previa: valores propios > tema > actuales
  const preview = {
    ...data.settings,
    display_name: form.display_name, tagline: form.tagline,
    primary_color: form.primary_color || theme?.primary_color || data.settings.primary_color,
    accent_color: form.accent_color || theme?.accent_color || data.settings.accent_color,
    font_display: form.font_display || theme?.font_display || data.settings.font_display,
    font_body: form.font_body || theme?.font_body || data.settings.font_body,
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e?.preventDefault();
    try {
      const body = { ...form, video_url: form.video_url || null, tagline: form.tagline || null, description: form.description || null };
      load((await api.put('/branding', body)).data);
      setMsg({ ok: 'Identidad guardada' });
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  const upload = async (kind, file, extra = {}) => {
    if (file.size > LIMIT_MB[kind] * 1024 * 1024) { return setMsg({ error: `"${file.name}" supera ${LIMIT_MB[kind]} MB` }); }
    const fd = new FormData();
    fd.append('kind', kind);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    setProgress({ kind, pct: 0 });
    try {
      const r = await api.post('/branding/assets', fd, { onUploadProgress: (p) => setProgress({ kind, pct: Math.round((p.loaded / (p.total || 1)) * 100) }) });
      load(r.data);
      setMsg({ ok: `${file.name} subido` });
    } catch (err) { setMsg({ error: `${file.name}: ${errMsg(err)}` }); } finally { setProgress(null); }
  };
  const uploadMany = async (files) => { for (const f of files) { await upload('image', f, { category, title: f.name.replace(/\.[^.]+$/, '') }); } };
  const removeAsset = async (kind) => { try { load((await api.delete(`/branding/assets/${kind}`)).data); } catch (err) { setMsg({ error: errMsg(err) }); } };
  const updateItem = async (id, body) => { try { load((await api.put(`/branding/gallery/${id}`, body)).data); } catch (err) { setMsg({ error: errMsg(err) }); } };
  const move = async (i, d) => {
    const ids = data.gallery.map((g) => g.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    try { load((await api.post('/branding/gallery/reorder', { order: ids })).data); } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const deleteItem = async () => {
    try { load((await api.delete(`/branding/gallery/${confirmDel.id}`)).data); setConfirmDel(null); } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  const publicUrl = `${location.origin}/c/${data.tenant.slug}`;

  return (
    <div className="space-y-6">
      <PageTitle action={<button className="btn-primary" onClick={save}>Guardar cambios</button>}>Identidad y galería</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand-600))]" checked={form.public_enabled} onChange={(e) => set('public_enabled', e.target.checked)} />
          <span><span className="block font-medium">Página pública del complejo</span>
            <span className="text-sm text-slate-500">Muestra portada, video y galería. Guardá para aplicar.</span></span>
        </label>
        {data.settings.public_enabled && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary"><Icon name="external" className="h-4 w-4" />{publicUrl.replace(/^https?:\/\//, '')}</a>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <form onSubmit={save} className="card space-y-4">
          <h2 className="font-semibold">Datos</h2>
          <Field label="Nombre visible"><input className="input" maxLength={120} value={form.display_name} onChange={(e) => set('display_name', e.target.value)} /></Field>
          <Field label="Frase de portada"><input className="input" maxLength={200} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
          <Field label="Descripción"><textarea className="input" rows={4} maxLength={1000} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>

          <h2 className="pt-2 font-semibold">Tema</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {themes.map((t) => (
              <button key={t.id} type="button" onClick={() => setForm((f) => ({ ...f, theme_id: t.id, primary_color: null, accent_color: null, font_display: null, font_body: null }))}
                aria-pressed={form.theme_id === t.id}
                className={`rounded-xl border p-3 text-left text-sm transition-[border-color,box-shadow] duration-150 ${form.theme_id === t.id ? 'border-brand-600 ring-2 ring-brand-600/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                <span className="mb-2 flex gap-1"><span className="h-5 w-5 rounded-full" style={{ background: t.primary_color }} /><span className="h-5 w-5 rounded-full" style={{ background: t.accent_color }} /></span>
                <span className="block font-medium">{t.name}</span><span className="text-xs text-slate-500">{t.font_display}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[['primary_color', 'Color principal'], ['accent_color', 'Color de acento']].map(([k, l]) => (
              <Field key={k} label={`${l} ${form[k] ? '' : '(del tema)'}`}>
                <span className="flex gap-2">
                  <input type="color" className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                    value={form[k] || preview[k]} onChange={(e) => set(k, e.target.value)} aria-label={l} />
                  <input className="input font-mono" value={form[k] || ''} placeholder={preview[k]} onChange={(e) => set(k, e.target.value || null)} pattern="#[0-9a-fA-F]{6}" />
                </span>
              </Field>
            ))}
            {[['font_display', 'Tipografía de títulos'], ['font_body', 'Tipografía de textos']].map(([k, l]) => (
              <Field key={k} label={l}>
                <select className="input" value={form[k] || ''} onChange={(e) => set(k, e.target.value || null)}>
                  <option value="">Del tema ({theme?.[k] || preview[k]})</option>
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <Field label="Video institucional externo (YouTube o Vimeo, opcional)">
            <input className="input" type="url" placeholder="https://www.youtube.com/watch?v=…" value={form.video_url} onChange={(e) => set('video_url', e.target.value)} />
          </Field>
          <button className="btn-primary">Guardar cambios</button>
        </form>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <h2 className="font-semibold">Vista previa</h2>
          <Preview s={preview} />
          <p className="text-xs text-slate-500">El texto de los botones se ajusta solo (blanco u oscuro) para mantener el contraste WCAG AA.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[['logo', 'Logo', data.settings.logo_url], ['cover', 'Portada', data.settings.cover_url], ['video', 'Video institucional', data.settings.video_external ? null : data.settings.video_url]].map(([k, l, url]) => (
          <div key={k} className="relative">
            <UploadSlot kind={k} label={l} url={url} busy={!!progress} onUpload={upload} onRemove={removeAsset} />
            {progress?.kind === k && <div className="absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-700"><div className="h-full bg-brand-600 transition-[width]" style={{ width: `${progress.pct}%` }} /></div>}
          </div>
        ))}
      </div>

      <section className="card space-y-4" aria-labelledby="gal-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="gal-title" className="font-semibold">Galería ({data.gallery.length})</h2>
          <div className="flex items-end gap-2">
            <Field label="Categoría de las nuevas">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            <label className={`btn-primary cursor-pointer ${progress ? 'pointer-events-none opacity-50' : ''}`}>
              <Icon name="upload" className="h-4 w-4" />{progress?.kind === 'image' ? `Subiendo ${progress.pct}%` : 'Subir imágenes'}
              <input type="file" accept={ACCEPT.image} multiple className="sr-only" onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; uploadMany(f); }} />
            </label>
          </div>
        </div>
        {data.gallery.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Subí fotos del complejo: ingreso, club house, piscinas, calles, amenities…</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.gallery.map((g, i) => (
            <li key={g.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <img src={g.url} alt={g.title || ''} loading="lazy" width={g.width} height={g.height} className="aspect-video w-full object-cover" />
              <div className="space-y-2 p-3">
                <input className="input" defaultValue={g.title || ''} placeholder="Título" aria-label="Título"
                  onBlur={(e) => e.target.value !== (g.title || '') && updateItem(g.id, { title: e.target.value || null })} />
                <div className="flex items-center gap-2">
                  <select className="input" value={g.category} aria-label="Categoría" onChange={(e) => updateItem(g.id, { category: e.target.value })}>
                    {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button type="button" className="btn-secondary px-2" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir en el orden"><Icon name="up" className="h-4 w-4" /></button>
                  <button type="button" className="btn-secondary px-2" disabled={i === data.gallery.length - 1} onClick={() => move(i, 1)} aria-label="Bajar en el orden"><Icon name="down" className="h-4 w-4" /></button>
                  <button type="button" className="btn-secondary px-2 text-red-600" onClick={() => setConfirmDel(g)} aria-label="Eliminar"><Icon name="trash" className="h-4 w-4" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {confirmDel && (
        <Modal title="Eliminar imagen" onClose={() => setConfirmDel(null)}>
          <p className="text-sm">¿Seguro que deseas eliminar esta imagen definitivamente? Se borra también el archivo.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancelar</button>
            <button className="btn-danger" onClick={deleteItem}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
