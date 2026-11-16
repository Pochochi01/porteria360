import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ConfirmDelete, EditModal } from '../components/crud';

/**
 * Edición y borrado reutilizable para cualquier listado.
 *   const crud = useCrud({ path: '/lots', label: 'lote', fields, onChange: reload });
 *   <td>{crud.actions(row)}</td> ... {crud.ui}
 */
export function useCrud({ path, label, fields, onChange, canEdit = true, deleteRoles = ['admin'] }) {
  const { is } = useAuth();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const canDelete = is(...deleteRoles);

  const save = async (payload) => {
    await api.put(`${path}/${editing.id}`, payload);
    setEditing(null);
    onChange?.();
  };

  const confirmDelete = async () => {
    setDeleting((d) => ({ ...d, busy: true, error: '' }));
    try {
      await api.delete(`${path}/${deleting.row.id}`, { params: deleting.deps ? { force: 1 } : {} });
      setDeleting(null);
      onChange?.();
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.dependencies) {
        setDeleting((d) => ({ ...d, busy: false, deps: data.dependencies, blocked: !!data.blocked, error: data.blocked ? data.error : '' }));
      } else {
        setDeleting((d) => ({ ...d, busy: false, error: errMsg(err) }));
      }
    }
  };

  const actions = (row) => (
    <span className="inline-flex gap-1 whitespace-nowrap">
      {canEdit && fields && (
        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" onClick={() => setEditing(row)}>Editar</button>
      )}
      {canDelete && (
        <button className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => setDeleting({ row })}>Eliminar</button>
      )}
    </span>
  );

  const ui = (
    <>
      {editing && <EditModal title={`Editar ${label}`} fields={typeof fields === 'function' ? fields(editing) : fields} row={editing} onSave={save} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDelete state={deleting} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />}
    </>
  );

  return { actions, ui };
}
