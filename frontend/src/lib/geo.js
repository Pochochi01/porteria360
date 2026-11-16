/**
 * Posición actual del dispositivo. Nunca rechaza: sin permiso, sin GPS o por timeout devuelve {}.
 * @param {number} [timeout] ms
 * @returns {Promise<{ lat?: number, lng?: number }>}
 */
export function currentPosition(timeout = 5000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout }
    );
  });
}
