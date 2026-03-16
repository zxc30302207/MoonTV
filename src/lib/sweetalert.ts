export async function getSwal() {
  const mod = await import('sweetalert2');
  return mod.default;
}
