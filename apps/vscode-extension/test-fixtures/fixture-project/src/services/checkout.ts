export async function submitCheckout(): Promise<Response> {
  return fetch("/api/checkout");
}
