import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';

/** GET con estado de carga/error y función reload. Sin url (null) no pide nada. */
export function useFetch(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    if (!url) { return; }
    api.get(url).then((r) => setData(r.data)).catch((e) => setError(errMsg(e)));
  }, [url]);
  useEffect(reload, [reload]);
  return { data, error, reload, setData };
}
