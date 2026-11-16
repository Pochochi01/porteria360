const PIE_COLORS = ['#0f766e', '#2563eb', '#f59e0b', '#db2777', '#7c3aed', '#059669', '#ea580c', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#a16207'];

/** Color estable por posición (lo comparten el gráfico de torta y su leyenda). */
export const pieColor = (i) => PIE_COLORS[i % PIE_COLORS.length];
