import { useState } from 'react';

/** Estado de formulario controlado. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name, parse) => ({
    name,
    value: values[name] ?? '',
    onChange: (e) => setValues((v) => ({ ...v, [name]: parse ? parse(e.target.value) : e.target.value })),
  });
  return { values, setValues, bind, reset: () => setValues(initial) };
}
